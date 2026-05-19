import fs from "fs";
import path from "path";

const FACTORY_URL =
    "https://raw.githubusercontent.com/XCSoar/XCSoar/refs/heads/master/src/InfoBoxes/Content/Factory.cpp";

const TYPE_URL =
    "https://raw.githubusercontent.com/XCSoar/XCSoar/refs/heads/master/src/InfoBoxes/Content/Type.hpp";

const OUT_DIR = "content/3.info-boxes";

/* -------------------- FETCH -------------------- */

async function fetchText(url) {
    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(`Failed to fetch ${url}`);
    }

    return await res.text();
}

/* -------------------- TYPE.hpp IDS -------------------- */

function extractIds(typeText) {
    const start = typeText.indexOf("enum Type");

    if (start === -1) {
        throw new Error("enum Type not found");
    }

    const braceStart = typeText.indexOf("{", start);

    let depth = 0;
    let block = "";

    for (let i = braceStart; i < typeText.length; i++) {
        const c = typeText[i];

        if (c === "{") depth++;
        if (c === "}") depth--;

        block += c;

        if (depth === 0) break;
    }

    const ids = [];

    for (let line of block.split("\n")) {
        line = line.trim();

        if (!line) continue;
        if (line === "{" || line === "};") continue;

        // extract comment
        const commentMatch = line.match(/\/\*\s*(.*?)\s*\*\//);
        const idDescription = commentMatch?.[1]?.trim() ?? null;

        // remove comments
        line = line.replace(/\/\*.*?\*\//g, "").trim();
        line = line.replace(/\/\/.*$/, "").trim();

        // remove trailing comma
        line = line.replace(/,$/, "").trim();

        // remove assignment
        line = line.split("=")[0].trim();

        // IGNORE pure comment leftovers
        if (!line) continue;

        // IMPORTANT: id is first token before space or tab
        // or full symbol until whitespace/comma
        const id = line.split(/\s+/)[0].trim();

        // skip invalid junk
        if (id === "NUM_TYPES") continue;
        if (id === "{") continue;
        if (id === "}") continue;

        ids.push({
            id,
            idDescription
        });
    }

    return ids;
}

/* -------------------- FACTORY PARSER -------------------- */

function extractMetaDataBlock(text) {
    const marker = "static constexpr MetaData meta_data[]";
    const startIndex = text.indexOf(marker);

    if (startIndex === -1) {
        throw new Error("meta_data[] not found");
    }

    const firstBrace = text.indexOf("{", startIndex);

    let depth = 0;

    for (let i = firstBrace; i < text.length; i++) {
        const c = text[i];

        if (c === "{") depth++;
        if (c === "}") depth--;

        if (depth === 0) {
            return text.slice(firstBrace, i + 1);
        }
    }

    throw new Error("Unclosed block");
}

function splitEntries(block) {
    const inner = block.slice(1, -1);

    const entries = [];

    let depth = 0;
    let start = 0;

    for (let i = 0; i < inner.length; i++) {
        const c = inner[i];

        if (c === "{") {
            if (depth === 0) {
                start = i;
            }

            depth++;
        }

        if (c === "}") {
            depth--;

            if (depth === 0) {
                entries.push(inner.slice(start, i + 1));
            }
        }
    }

    return entries;
}

function splitFields(entry) {
    const inner = entry.slice(1, -1);

    const fields = [];

    let current = "";
    let inString = false;
    let escape = false;
    let templateDepth = 0;

    for (let i = 0; i < inner.length; i++) {
        const c = inner[i];

        if (escape) {
            current += c;
            escape = false;
            continue;
        }

        if (c === "\\") {
            current += c;
            escape = true;
            continue;
        }

        if (c === '"') {
            inString = !inString;
            current += c;
            continue;
        }

        if (!inString) {
            if (c === "<") templateDepth++;
            if (c === ">") templateDepth--;
        }

        if (
            c === "," &&
            !inString &&
            templateDepth === 0
        ) {
            fields.push(current.trim());
            current = "";
        } else {
            current += c;
        }
    }

    if (current.trim()) {
        fields.push(current.trim());
    }

    return fields;
}

/* -------------------- CLEAN -------------------- */

function clean(field) {
    if (!field) {
        return null;
    }

    let m = field.match(/N_\("([\s\S]*?)"\)/);

    if (m) {
        return m[1];
    }

    m = field.match(/"([\s\S]*?)"/);

    if (m) {
        return m[1];
    }

    if (field === "NULL") {
        return null;
    }

    return field.trim();
}

/* -------------------- PARSE ENTRY -------------------- */

function parseEntry(entry) {
    const fields = splitFields(entry);

    return {
        title: clean(fields[0]),
        caption: clean(fields[1]),
        description: clean(fields[2])
    };
}

/* -------------------- OUTPUT -------------------- */

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function escapeYamlString(value) {
    if (value === null || value === undefined) {
        return "";
    }

    let str = String(value);

    // normalize line breaks
    str = str.replace(/\r\n/g, "\n");

    // escape problematic YAML chars
    str = str
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t");

    // avoid YAML-breaking leading indicators
    if (
        str.startsWith("-") ||
        str.startsWith(":") ||
        str.startsWith("?") ||
        str.startsWith("@") ||
        str.startsWith("`")
    ) {
        str = `"${str}"`;
    }

    // avoid document break
    if (str.trim() === "---") {
        str = '"---"';
    }

    return str;
}

function formatMarkdown(item) {
    return `---
id: ${escapeYamlString(item.id ?? "unknown")}
title: ${escapeYamlString(item.title ?? "")}
caption: ${escapeYamlString(item.caption ?? "")}
description: ${escapeYamlString(item.description ?? "")}
idDescription: ${escapeYamlString(item.idDescription ?? "")}
---
`;
}

/* -------------------- MAIN -------------------- */

async function main() {
    const [factoryText, typeText] = await Promise.all([
        fetchText(FACTORY_URL),
        fetchText(TYPE_URL)
    ]);

    const ids = extractIds(typeText);

    console.log("IDS:", ids.length);

    const block = extractMetaDataBlock(factoryText);
    const rawEntries = splitEntries(block);

    console.log("ENTRIES:", rawEntries.length);

    const entries = rawEntries.map((entry, index) => {
        const item = parseEntry(entry);

        return {
            ...item,
            id: ids[index].id ?? null,
            idDescription: ids[index].idDescription ?? null,
        };
    });

    ensureDir(OUT_DIR);

    for (let i = 0; i < entries.length; i++) {
        const item = entries[i];

        console.log(i, item.id, item.title);

        const fileName =
            `${String(i).padStart(3, "0")}.${item.id ?? "unknown"}.md`;

        const filePath = path.join(OUT_DIR, fileName);

        fs.writeFileSync(
            filePath,
            formatMarkdown(item),
            "utf-8"
        );
    }

    console.log(`Done: ${entries.length} files written`);
}

main().catch(console.error);
