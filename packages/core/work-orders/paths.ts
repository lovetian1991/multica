export function versionDirectoryName(name: string): string {
  const value = Array.from(name, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 || '<>:"/\\|?*'.includes(char) ? "-" : char;
  }).join("").replace(/^[ .]+|[ .]+$/g, "");
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) ? `_${value}` : value;
}
