import fs from "fs";
const path = process.argv[2];
const lines = fs.readFileSync(path, "utf8").split("\n");
let bal = 0;
for (let i = 0; i < lines.length; i++) {
  const s = lines[i];
  let q = "";
  let d = 0;
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    if (q) {
      if (c === "\\") { j++; continue; }
      if (c === q) q = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { q = c; continue; }
    if (c === "/" && s[j + 1] === "/") break;
    if (c === "/" && s[j + 1] === "*") { const e = s.indexOf("*/", j + 2); j = e >= 0 ? e + 1 : s.length; continue; }
    if (c === "(") d++;
    else if (c === ")") d--;
  }
  bal += d;
  // report the first top-level function whose body ends while parens are open
  if (/^}/.test(s) && bal !== 0) {
    console.log(`line ${i + 1}: closing brace with paren balance ${bal}`);
    console.log("  ", s.slice(0, 70));
    // walk back to find the start of this function
    for (let k = i; k >= 0; k--) {
      if (/^(export )?function|^\/\*\*/.test(lines[k])) {
        console.log("   function starts at", k + 1, lines[k].slice(0, 60));
        break;
      }
    }
    break;
  }
}
console.log("final balance", bal);
