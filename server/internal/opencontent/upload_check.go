package opencontent

import (
	"fmt"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
)

// ValidateUploadCheck 验证 upload-check 请求中声明的文件大小和扩展名。
// 请求体是 application/x-www-form-urlencoded 格式，包含 size、fileName 和 ext 字段。
func ValidateUploadCheck(body []byte, maxBytes int64, allowedExts []string) error {
	if maxBytes <= 0 {
		return fmt.Errorf("upload size limit not configured")
	}

	values, err := url.ParseQuery(string(body))
	if err != nil {
		return fmt.Errorf("invalid upload-check request body")
	}

	// 验证文件大小
	sizeStr := values.Get("size")
	if sizeStr == "" {
		return fmt.Errorf("size field is required")
	}

	size, err := strconv.ParseInt(sizeStr, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid size value: %v", err)
	}

	if size > maxBytes {
		return fmt.Errorf("file size %d bytes exceeds limit of %d bytes", size, maxBytes)
	}

	// 验证文件扩展名
	fileName := values.Get("fileName")
	ext := values.Get("ext")

	// 优先使用 ext 字段，如果没有则从 fileName 提取
	if ext == "" && fileName != "" {
		ext = strings.TrimPrefix(filepath.Ext(fileName), ".")
	}

	if ext == "" {
		return fmt.Errorf("file extension not found")
	}

	ext = strings.ToLower(ext)

	// 如果没有配置允许的扩展名，则不限制
	if len(allowedExts) == 0 {
		return nil
	}

	// 检查扩展名是否在允许列表中
	for _, allowed := range allowedExts {
		allowed = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(allowed, ".")))
		if ext == allowed {
			return nil
		}
	}

	return fmt.Errorf("file extension .%s is not allowed", ext)
}
