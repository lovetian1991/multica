package opencontent

import (
	"bytes"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"
)

var uploadContentTypes = map[string]string{
	".md": "text/markdown", ".txt": "text/plain", ".pdf": "application/pdf",
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
	".gif": "image/gif", ".webp": "image/webp",
}

// ValidateMultipartUpload validates the complete multipart payload before it is
// sent upstream. The part Content-Type is not trusted.
func ValidateMultipartUpload(body []byte, contentType string, maxBytes int64, allowedExtensions []string) error {
	if maxBytes <= 0 || int64(len(body)) > maxBytes {
		return fmt.Errorf("OpenContent upload exceeds the configured size limit")
	}
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType != "multipart/form-data" || params["boundary"] == "" {
		return fmt.Errorf("OpenContent upload must be multipart/form-data")
	}
	allowed := make(map[string]struct{}, len(allowedExtensions))
	for _, ext := range allowedExtensions {
		ext = strings.ToLower(strings.TrimSpace(ext))
		if !strings.HasPrefix(ext, ".") {
			ext = "." + ext
		}
		allowed[ext] = struct{}{}
	}

	reader := multipart.NewReader(bytes.NewReader(body), params["boundary"])
	files := 0
	chunk := ""
	var declaredSize int64
	for {
		part, nextErr := reader.NextPart()
		if nextErr == io.EOF {
			break
		}
		if nextErr != nil {
			return fmt.Errorf("invalid OpenContent multipart upload")
		}
		if part.FileName() == "" {
			value, readErr := io.ReadAll(io.LimitReader(part, 256))
			if readErr != nil {
				return fmt.Errorf("invalid OpenContent multipart upload")
			}
			if part.FormName() == "chunk" {
				chunk = strings.TrimSpace(string(value))
			}
			if part.FormName() == "size" {
				declaredSize = parsePositiveInt(string(value))
			}
			continue
		}
		files++
		ext := strings.ToLower(filepath.Ext(filepath.Base(part.FileName())))
		if _, ok := allowed[ext]; !ok {
			return fmt.Errorf("OpenContent upload extension %q is not allowed", ext)
		}
		if chunk == "" || chunk == "0" {
			if err := validatePartContent(part, ext); err != nil {
				return err
			}
		} else if err := validateNonEmptyPart(part); err != nil {
			return err
		}
	}
	if files == 0 {
		return fmt.Errorf("OpenContent upload does not contain a file")
	}
	if declaredSize > maxBytes {
		return fmt.Errorf("OpenContent upload exceeds the configured size limit")
	}
	return nil
}

func parsePositiveInt(raw string) int64 {
	var value int64
	for _, char := range strings.TrimSpace(raw) {
		if char < '0' || char > '9' {
			return 0
		}
		value = value*10 + int64(char-'0')
	}
	return value
}

func validateNonEmptyPart(part *multipart.Part) error {
	var one [1]byte
	n, err := part.Read(one[:])
	if err != nil && err != io.EOF {
		return fmt.Errorf("failed to inspect OpenContent upload")
	}
	if n == 0 {
		return fmt.Errorf("OpenContent upload contains an empty file")
	}
	return nil
}

func validatePartContent(part *multipart.Part, ext string) error {
	prefix := make([]byte, 512)
	read, err := io.ReadFull(part, prefix)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return fmt.Errorf("failed to inspect OpenContent upload")
	}
	if read == 0 {
		return fmt.Errorf("OpenContent upload contains an empty file")
	}
	if !matchesExtensionContentType(ext, prefix[:read]) {
		return fmt.Errorf("OpenContent upload content does not match extension %q", ext)
	}
	return nil
}

func matchesExtensionContentType(ext string, prefix []byte) bool {
	expected := uploadContentTypes[ext]
	if expected == "" {
		return false
	}
	detected := http.DetectContentType(prefix)
	if detected == expected || (ext == ".md" || ext == ".txt") && strings.HasPrefix(detected, "text/") {
		return true
	}
	if ext == ".webp" {
		return len(prefix) >= 12 && bytes.Equal(prefix[:4], []byte("RIFF")) && bytes.Equal(prefix[8:12], []byte("WEBP"))
	}
	return false
}
