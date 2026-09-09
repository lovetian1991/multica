package service

import (
	"encoding/json"
	"testing"
)

func TestQuickCreateContextCarriesKBFolderID(t *testing.T) {
	payload, err := json.Marshal(QuickCreateContext{
		Type:       QuickCreateContextType,
		Prompt:     "create a task",
		KBFolderID: "12998",
	})
	if err != nil {
		t.Fatal(err)
	}
	var decoded QuickCreateContext
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.KBFolderID != "12998" {
		t.Fatalf("kb_folder_id = %q, want 12998", decoded.KBFolderID)
	}
}
