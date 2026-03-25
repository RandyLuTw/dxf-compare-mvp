export async function readFileText(file) {
  return await file.text();
}

export async function parseDxfFile(file) {
  if (!file || !file.name?.toLowerCase().endsWith(".dxf")) {
    throw new Error("請選擇 .dxf 檔案");
  }

  const ParserCtor = globalThis.DxfParser;
  if (!ParserCtor) {
    throw new Error("DXF 解析器未載入，請重新整理頁面後再試。");
  }

  const parser = new ParserCtor();
  const text = await readFileText(file);
  try {
    const parsed = parser.parseSync(text);
    return {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      parsed,
      rawTextLength: text.length,
    };
  } catch (err) {
    throw new Error(`DXF 解析失敗: ${file.name} (${err.message})`);
  }
}

export function collectDxfFilesFromInput(fileList) {
  const out = [];
  for (const file of Array.from(fileList ?? [])) {
    if (!file.name.toLowerCase().endsWith(".dxf")) continue;
    out.push({
      file,
      name: file.name,
      baseName: file.name,
      relativePath: file.webkitRelativePath || file.name,
    });
  }
  return out;
}

export function pairByBaseName(listA, listB) {
  const mapA = new Map();
  const mapB = new Map();

  for (const item of listA) {
    if (!mapA.has(item.baseName)) mapA.set(item.baseName, item);
  }
  for (const item of listB) {
    if (!mapB.has(item.baseName)) mapB.set(item.baseName, item);
  }

  const names = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort();
  return names.map((name) => ({
    name,
    a: mapA.get(name) || null,
    b: mapB.get(name) || null,
  }));
}
