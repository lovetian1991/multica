package workorder

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type MISCredentials struct {
	Headers  map[string]string `json:"headers"`
	Token    string            `json:"token"`
	TaskUser string            `json:"task_user,omitempty"`
}

func ParseMISCredentials(raw []byte) (MISCredentials, error) {
	var c MISCredentials
	if err := json.Unmarshal(raw, &c); err != nil || c.Headers == nil || c.Token == "" {
		return c, fmt.Errorf("MIS credentials require headers and token")
	}
	for key, value := range c.Headers {
		switch strings.ToLower(key) {
		case "appid", "siteoutid", "inbizv5", "inbizv6", "v9", "ecm":
		default:
			return c, fmt.Errorf("unsupported MIS authentication header")
		}
		if strings.ContainsAny(value, "\r\n") {
			return c, fmt.Errorf("invalid MIS authentication header")
		}
	}
	if strings.ContainsAny(c.TaskUser, "\r\n\x00") || len(c.TaskUser) > 128 {
		return c, fmt.Errorf("invalid MIS task user")
	}
	return c, nil
}

type MISOrder struct {
	ID          string            `json:"id"`
	Number      string            `json:"number"`
	Title       string            `json:"title"`
	Description string            `json:"description"`
	Status      string            `json:"status"`
	Product     string            `json:"product"`
	Version     string            `json:"version"`
	Project     string            `json:"project"`
	Branch      string            `json:"branch"`
	Fields      map[string]string `json:"fields"`
}

type MISQuery struct {
	Mine       bool
	Page, Size int
	Search, ID string
}

func (order MISOrder) Summary() MISOrder {
	order.Description = ""
	fields := map[string]string{}
	for _, key := range []string{"customername", "taskname", "createname", "actorusername", "creationtime", "urgentlevel", "questiontype"} {
		if value := order.Fields[key]; value != "" {
			fields[key] = value
		}
	}
	order.Fields = fields
	return order
}

// FetchMISPage only calls the documented read-list endpoint. Redirects are disabled
// because the integration authenticates using custom headers.
func FetchMISPage(ctx context.Context, base string, c MISCredentials, page int) ([]MISOrder, int, error) {
	return QueryMIS(ctx, base, c, MISQuery{Page: page, Size: 100})
}

func QueryMIS(ctx context.Context, base string, c MISCredentials, query MISQuery) ([]MISOrder, int, error) {
	if query.Page < 1 || query.Page > 100000 || query.Size < 1 || query.Size > 100 || len(query.Search) > 256 {
		return nil, 0, fmt.Errorf("invalid MIS pagination or search")
	}
	if query.Mine && c.TaskUser == "" {
		return nil, 0, fmt.Errorf("configure the MIS task_user for this workspace before querying personal work orders")
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, 0, fmt.Errorf("invalid MIS base URL")
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/QcWorkOrder/List"
	form := url.Values{
		"eformControlId": {"Table"}, "isRequest": {"false"}, "enableFilterStr": {"true"},
		"enableQueryField": {"false"}, "exportHiddenFields": {"true"},
		"filterStr": {"status!='草稿'"}, "index": {strconv.Itoa(query.Page)}, "size": {strconv.Itoa(query.Size)},
		"orderField": {"creationtime"}, "token": {c.Token},
	}
	if query.Mine {
		u.Path = strings.TrimSuffix(u.Path, "/List") + "/ListWorkOrderTask"
		form.Set("eformControlId", "Table_wait")
		form.Set("exportHiddenFields", "false")
		form.Set("taskStatus", "0")
		form.Set("taskUser", c.TaskUser)
		form.Del("filterStr")
	}
	filters := []string{}
	if !query.Mine {
		filters = append(filters, "status!='草稿'")
	}
	quote := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
	if query.ID != "" {
		if len(query.ID) > 256 {
			return nil, 0, fmt.Errorf("invalid MIS work order id")
		}
		filters = append(filters, "id="+quote(query.ID))
	}
	if query.Search != "" {
		value := quote("%" + query.Search + "%")
		filters = append(filters, "(title like "+value+" or no like "+value+")")
	}
	if len(filters) > 0 {
		form.Set("filterStr", strings.Join(filters, " and "))
	}
	for _, key := range []string{"creationtime", "devdeliverydate", "qualityfinishdate", "endtime", "supportdate", "testcomplettime", "packagingtime", "timetopackage"} {
		form.Set(key, "$")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), strings.NewReader(form.Encode()))
	if err != nil {
		return nil, 0, fmt.Errorf("create MIS list request")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
	for key, value := range c.Headers {
		req.Header.Set(key, value)
	}
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("MIS list request failed; check the URL, network and credentials")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("MIS list returned HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024+1))
	if err != nil || len(data) > 8*1024*1024 {
		return nil, 0, fmt.Errorf("MIS list response exceeds the size limit")
	}
	var envelope struct {
		Success bool                         `json:"success"`
		Data    []map[string]json.RawMessage `json:"data"`
		Total   json.RawMessage              `json:"total"`
	}
	if json.Unmarshal(data, &envelope) != nil || !envelope.Success || envelope.Data == nil {
		return nil, 0, fmt.Errorf("MIS list failed or returned an invalid response")
	}
	total, err := strconv.Atoi(misText(envelope.Total))
	if err != nil || total < 0 || len(envelope.Data) > query.Size {
		return nil, 0, fmt.Errorf("MIS list returned invalid pagination")
	}
	orders := make([]MISOrder, 0, len(envelope.Data))
	for _, row := range envelope.Data {
		o := MISOrder{
			ID: misText(row["id"]), Number: misText(row["no"]), Title: misText(row["title"]), Description: misText(row["description"]),
			Status: misText(row["status"]), Product: misText(row["productname"]), Version: misText(row["productversionnum"]),
			Project: misText(row["projectname"]), Branch: misText(row["branch"]),
		}
		o.Fields = map[string]string{}
		for _, key := range []string{"customername", "taskname", "createname", "actorusername", "creationtime", "urgentlevel", "questiontype", "environment", "solution", "devsolution", "qualitysolution", "testrequirements", "testrange", "othercontent", "attachment", "newattachment", "solutionfile", "relatedfile", "testreport"} {
			if value := misText(row[key]); value != "" {
				o.Fields[key] = value
			}
		}
		if o.ID == "" || o.Title == "" || len(o.ID) > 256 || len(o.Title) > 1000 {
			return nil, 0, fmt.Errorf("MIS list contains an invalid work order")
		}
		orders = append(orders, o)
	}
	return orders, total, nil
}

func MergeOCDetail(order *MISOrder, detail map[string]json.RawMessage) {
	order.Title = misText(detail["title"])
	order.Description = misText(detail["description"])
	order.Status = misText(detail["status"])
	if order.Fields == nil {
		order.Fields = map[string]string{}
	}
	for _, key := range []string{"urgentlevel", "questiontype", "environment", "solution", "devsolution", "qualitysolution", "testrequirements", "testrange", "othercontent", "attachment", "newattachment", "solutionfile", "relatedfile", "testreport"} {
		if value := misText(detail[key]); value != "" {
			order.Fields[key] = value
		}
	}
}

func misText(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var value string
	if json.Unmarshal(raw, &value) == nil {
		return value
	}
	var number json.Number
	if json.Unmarshal(raw, &number) == nil {
		return number.String()
	}
	return ""
}
