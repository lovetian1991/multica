import fs from "node:fs";

const source = fs.readFileSync(new URL("../../1.md", import.meta.url), "utf8");
const requests = [...source.matchAll(/fetch\("([^"]+)",\s*(\{[\s\S]*?\})\);/g)];
for (const match of requests.slice(1, 2)) {
  const options = JSON.parse(match[2]);
  delete options.mode;
  delete options.credentials;
  try {
    const response = await fetch(match[1], { ...options, signal: AbortSignal.timeout(25000) });
    const text = await response.text();
    const data = JSON.parse(text);
    const rows = Array.isArray(data.data) ? data.data : [];
    console.log(JSON.stringify({
      path: new URL(match[1]).pathname, http: response.status,
      keys: Object.keys(data), success: data.success, total: data.total,
      rowKeys: rows[0] ? Object.keys(rows[0]) : [],
      dataKeys: data.data && !Array.isArray(data.data) ? Object.keys(data.data) : [],
      sample: rows[0] ? { id: rows[0].id, no: rows[0].no, title: rows[0].title } : null,
    }));
    if (rows[0]) {
      const form = new URLSearchParams(options.body);
      form.set("filterStr", `id='${rows[0].id}'`);
      const filtered = await (await fetch(match[1], { ...options, body: form.toString(), signal: AbortSignal.timeout(25000) })).json();
      console.log(JSON.stringify({ filteredSuccess: filtered.success, total: filtered.total,
        ids: filtered.data?.map((row) => row.id), fields: Object.fromEntries(Object.entries(filtered.data?.[0] ?? {}).filter(([key]) =>
          /^(no|customername|taskname|createname|actorusername|urgentlevel|solution|newattachment|attachment|devsolution|othercontent)$/i.test(key))) }));
    }
  } catch (error) {
    console.log(JSON.stringify({ path: new URL(match[1]).pathname, error: error.name }));
  }
}
