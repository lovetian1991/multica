package handler

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/multica-ai/multica/server/internal/opencontent"
	"github.com/multica-ai/multica/server/internal/testutil"
	"github.com/multica-ai/multica/server/internal/util/secretbox"
)

const (
	kbTestIntegrationKey = "kb-integration-key"
	kbTestRootFolderID   = "1413913"
)

// kbFolderTreeUpstream stands in for the OpenContent folder tree API. The auth
// handshake is served for real because the client RSA-encrypts the integration
// key with the upstream public key before any folder call, and the last folder
// request is kept so a test can assert what the handler asked for.
type kbFolderTreeUpstream struct {
	*httptest.Server

	mu      sync.Mutex
	request kbFolderTreeRequest
}

func (u *kbFolderTreeUpstream) lastRequest() kbFolderTreeRequest {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.request
}

func newKBFolderTreeUpstream(t *testing.T) *kbFolderTreeUpstream {
	t.Helper()

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate upstream RSA key: %v", err)
	}
	publicDER, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		t.Fatalf("marshal upstream public key: %v", err)
	}
	publicPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER})

	upstream := &kbFolderTreeUpstream{}
	mux := http.NewServeMux()
	mux.HandleFunc("/inbiz/auth/api/Auth/GetLoginRsaPublicKey", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, `{"data":{"PublicKey":%s}}`, strconv.Quote(string(publicPEM)))
	})
	mux.HandleFunc("/FlatDms/v800/Document/FolderTree/GetChildrenFolderTreeNodes", func(w http.ResponseWriter, r *http.Request) {
		var request kbFolderTreeRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode folder tree request: %v", err)
		}
		upstream.mu.Lock()
		upstream.request = request
		upstream.mu.Unlock()
		fmt.Fprint(w, `{"result":0,"data":{`+
			`"totalCount":5,`+
			`"currentFolder":{"folderId":1413913,"folderName":"root","folderPath":"/root","parentFolderId":1},`+
			`"children":[`+
			`{"folderId":1413914,"folderName":"base","folderPath":"/base","parentFolderId":1413913},`+
			`{"folderId":1413915,"folderName":"help","folderPath":"/help","parentFolderId":1413913}]}}`)
	})

	upstream.Server = httptest.NewServer(mux)
	t.Cleanup(upstream.Close)
	return upstream
}

// stubKBFolderTreeSettings points the deployment knowledge-base settings at the
// fake upstream. system_setting is a singleton row shared by the whole test
// database, so the values found on entry are put back when the test ends.
func stubKBFolderTreeSettings(t *testing.T, upstreamURL string) {
	t.Helper()

	box, err := secretbox.New([]byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatalf("create secret box: %v", err)
	}
	sealed, err := box.Seal([]byte(kbTestIntegrationKey))
	if err != nil {
		t.Fatalf("seal integration key: %v", err)
	}

	var (
		hadRow         bool
		previousURL    string
		previousSecret string
	)
	switch err := testPool.QueryRow(context.Background(),
		`SELECT kb_environment_url, kb_integration_key_encrypted FROM system_setting WHERE id = TRUE`,
	).Scan(&previousURL, &previousSecret); {
	case err == nil:
		hadRow = true
	case !errors.Is(err, pgx.ErrNoRows):
		t.Fatalf("read system_setting: %v", err)
	}

	previousBox := testHandler.SystemSettingsSecretBox
	previousClient := testHandler.OpenContent
	client, err := opencontent.NewClient(opencontent.Config{})
	if err != nil {
		t.Fatalf("create OpenContent client: %v", err)
	}
	testHandler.SystemSettingsSecretBox = box
	testHandler.OpenContent = client
	t.Cleanup(func() {
		testHandler.SystemSettingsSecretBox = previousBox
		testHandler.OpenContent = previousClient
	})

	dbfx.Exec(t, `INSERT INTO system_setting (id, kb_environment_url, kb_integration_key_encrypted)
		VALUES (TRUE, $1, $2)
		ON CONFLICT (id) DO UPDATE SET
			kb_environment_url = EXCLUDED.kb_environment_url,
			kb_integration_key_encrypted = EXCLUDED.kb_integration_key_encrypted`,
		upstreamURL, base64.StdEncoding.EncodeToString(sealed))

	if hadRow {
		dbfx.Cleanup(t,
			`UPDATE system_setting SET kb_environment_url = $1, kb_integration_key_encrypted = $2 WHERE id = TRUE`,
			previousURL, previousSecret)
		return
	}
	dbfx.Cleanup(t, `DELETE FROM system_setting WHERE id = TRUE`)
}

func productVersionForPicker(t *testing.T, folderID string) (string, string) {
	t.Helper()

	productID := dbfx.Insert(t, "product", testutil.Cols{
		"name": "Picker product",
	})
	versionID := dbfx.Insert(t, "product_version", testutil.Cols{
		"product_id": productID,
		"name":       "Picker version",
		"directory":  "",
		"remark":     "",
		"folder_id":  folderID,
		"enabled":    true,
	})
	return productID, versionID
}

func productVersionFolderRequest(productID, versionID string, pageIndex int) *http.Request {
	path := "/api/products/" + productID + "/versions/" + versionID + "/folders"
	if pageIndex > 0 {
		path += "?page_index=" + strconv.Itoa(pageIndex)
	}
	return testutil.WithURLParams(
		newRequest(http.MethodGet, path, nil),
		"id", productID,
		"versionId", versionID,
	)
}

// TestListProductVersionFoldersServesPickerFoldersToNonAdmins pins the endpoint
// the issue pickers need: the version row supplies the parent folder, and an
// ordinary member — the handler suite leaves the system administrator
// allowlist empty — gets the folder list where the old administrative route
// answered 403.
func TestListProductVersionFoldersServesPickerFoldersToNonAdmins(t *testing.T) {
	upstream := newKBFolderTreeUpstream(t)
	stubKBFolderTreeSettings(t, upstream.URL)

	productID, versionID := productVersionForPicker(t, kbTestRootFolderID)

	response := testutil.Decode[GetFolderTreeResponse](
		t,
		testHandler.ListProductVersionFolders,
		productVersionFolderRequest(productID, versionID, 2),
		http.StatusOK,
	)

	if response.TotalCount != 5 {
		t.Fatalf("total count = %d, want 5", response.TotalCount)
	}
	if len(response.Folders) != 2 {
		t.Fatalf("folders = %+v, want two children", response.Folders)
	}
	if response.Folders[0].FolderID != "1413914" || response.Folders[0].FolderName != "base" {
		t.Fatalf("first folder = %+v, want the upstream child with a string id", response.Folders[0])
	}
	if response.Folders[0].ParentFolderID != kbTestRootFolderID {
		t.Fatalf("parent folder = %q, want %q", response.Folders[0].ParentFolderID, kbTestRootFolderID)
	}
	if response.CurrentFolder == nil || response.CurrentFolder.FolderID != kbTestRootFolderID {
		t.Fatalf("current folder = %+v, want the version's folder", response.CurrentFolder)
	}

	// The version row, not the request, decides which folder is listed, and the
	// page index survives the round trip.
	request := upstream.lastRequest()
	if request.ParentFolderID != kbTestRootFolderID {
		t.Fatalf("upstream parent folder = %q, want %q", request.ParentFolderID, kbTestRootFolderID)
	}
	if request.PageIndex != 2 {
		t.Fatalf("upstream page index = %d, want 2", request.PageIndex)
	}
	if request.Token != kbTestIntegrationKey {
		t.Fatalf("upstream token = %q, want the decrypted integration key", request.Token)
	}
}

func TestListProductVersionFoldersHidesVersionsOfAnotherProduct(t *testing.T) {
	upstream := newKBFolderTreeUpstream(t)
	stubKBFolderTreeSettings(t, upstream.URL)

	_, versionID := productVersionForPicker(t, kbTestRootFolderID)
	otherProductID := dbfx.Insert(t, "product", testutil.Cols{
		"name": "Other product",
	})

	testutil.Call(t, testHandler.ListProductVersionFolders,
		productVersionFolderRequest(otherProductID, versionID, 1),
	).Want(http.StatusNotFound)
}

func TestListProductVersionFoldersRejectsVersionWithoutFolder(t *testing.T) {
	upstream := newKBFolderTreeUpstream(t)
	stubKBFolderTreeSettings(t, upstream.URL)

	productID, versionID := productVersionForPicker(t, "")

	testutil.Call(t, testHandler.ListProductVersionFolders,
		productVersionFolderRequest(productID, versionID, 1),
	).Want(http.StatusBadRequest)
}
