package opencontent

import (
	"bytes"
	"mime/multipart"
	"net/textproto"
	"strconv"
	"strings"
	"testing"
)

func multipartBody(t *testing.T, filename string, content []byte, chunk int) ([]byte, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for key, value := range map[string]string{"chunk": strconv.Itoa(chunk)} {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatal(err)
		}
	}
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="file"; filename="`+filename+`"`)
	header.Set("Content-Type", "application/octet-stream")
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return body.Bytes(), writer.FormDataContentType()
}

func TestValidateMultipartUpload(t *testing.T) {
	body, contentType := multipartBody(t, "note.txt", []byte("hello"), 0)
	if err := ValidateMultipartUpload(body, contentType, 1024, []string{".txt"}); err != nil {
		t.Fatalf("valid upload rejected: %v", err)
	}
}

func TestValidateMultipartUploadRejectsExtensionAndContent(t *testing.T) {
	body, contentType := multipartBody(t, "note.exe", []byte("MZ"), 0)
	if err := ValidateMultipartUpload(body, contentType, 1024, []string{".txt"}); err == nil || !strings.Contains(err.Error(), "not allowed") {
		t.Fatalf("extension was not rejected: %v", err)
	}

	body, contentType = multipartBody(t, "note.pdf", []byte("plain text"), 0)
	if err := ValidateMultipartUpload(body, contentType, 1024, []string{".pdf"}); err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("content mismatch was not rejected: %v", err)
	}
}

func TestValidateMultipartUploadAllowsLaterChunkWithoutFullSniff(t *testing.T) {
	body, contentType := multipartBody(t, "note.txt", []byte{0x00, 0x01}, 1)
	if err := ValidateMultipartUpload(body, contentType, 1024, []string{".txt"}); err != nil {
		t.Fatalf("later chunk rejected: %v", err)
	}
}
