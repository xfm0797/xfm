'use strict';
/**
 * Front-matter 解析（YAML 子集）+ 轻量 YAML 解析器
 * 支持：key: value、嵌套缩进、- 列表、行内 [a, b]、"引号" 与布尔/数字/日期原值
 */

function parseScalar(raw) {
  const v = raw.trim();
  if (v === '' || v === '~' || v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    // 双引号内允许 \" 与 \n，用 JSON 语义还原（失败时退回朴素截取）
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1).replace(/\\n/g, '\n');
    }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
    return v.slice(1, -1).replace(/''/g, "'"); // YAML 单引号里用 '' 表示一个单引号
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    return v.slice(1, -1).split(',').map((x) => parseScalar(x)).filter((x) => x !== null);
  }
  if (v.startsWith('{') && v.endsWith('}')) {
    const o = {};
    v.slice(1, -1).split(',').forEach((pair) => {
      const i = pair.indexOf(':');
      if (i > -1) o[pair.slice(0, i).trim()] = parseScalar(pair.slice(i + 1));
    });
    return o;
  }
  return v;
}

/** 解析 YAML 文本为对象（缩进嵌套 + 列表） */
function parseYaml(src) {
  const lines = src.split('\n');
  let i = 0;

  const indent = (l) => l.length - l.trimStart().length;

  function parseBlock(minIndent) {
    const first = lines[i];
    if (first === undefined) return null;
    if (/^\s*-\s|^\s*-$/.test(first)) {
      const arr = [];
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim() || l.trim().startsWith('#')) { i++; continue; }
        if (indent(l) < minIndent || !/^\s*-(\s|$)/.test(l)) break;
        const rest = l.trim().slice(1).trim();
        i++;
        if (!rest) {
          arr.push(parseBlock(indent(l) + 1));
        } else if (/^[^:]+:(\s|$)/.test(rest)) {
          // 列表项是对象
          const obj = {};
          const objIndent = indent(l) + 2;
          const [k, ...v] = rest.split(':');
          const val = v.join(':').trim();
          if (val) obj[k.trim()] = parseScalar(val);
          else obj[k.trim()] = parseBlock(objIndent);
          // 后续同缩进的键
          while (i < lines.length && lines[i].trim() && indent(lines[i]) >= objIndent && !/^\s*-(\s|$)/.test(lines[i])) {
            const line2 = lines[i];
            const ci = line2.indexOf(':');
            if (ci === -1) { i++; continue; }
            const k2 = line2.slice(0, ci).trim();
            const v2 = line2.slice(ci + 1).trim();
            i++;
            obj[k2] = v2 ? parseScalar(v2) : parseBlock(indent(line2) + 1);
          }
          arr.push(obj);
        } else {
          arr.push(parseScalar(rest));
        }
      }
      return arr;
    }

    const obj = {};
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim() || l.trim().startsWith('#')) { i++; continue; }
      if (indent(l) < minIndent) break;
      const ci = l.indexOf(':');
      if (ci === -1) { i++; continue; }
      const key = l.slice(0, ci).trim();
      const val = l.slice(ci + 1).trim();
      i++;
      if (val === '') {
        // 可能是嵌套对象/列表，或空值
        const next = lines[i];
        if (next !== undefined && next.trim() && indent(next) > indent(l)) {
          obj[key] = parseBlock(indent(next));
        } else {
          obj[key] = null;
        }
      } else if (val === '|' || val === '>') {
        const body = [];
        const baseIndent = lines[i] !== undefined ? indent(lines[i]) : 0;
        while (i < lines.length && (!lines[i].trim() || indent(lines[i]) >= baseIndent)) {
          body.push(lines[i].slice(baseIndent));
          i++;
        }
        obj[key] = val === '|' ? body.join('\n').replace(/\n+$/, '') : body.join(' ').trim();
      } else {
        obj[key] = parseScalar(val);
      }
    }
    return obj;
  }

  return parseBlock(0) || {};
}

/**
 * 拆分 front-matter
 * @returns {{data:object, content:string, raw:string}}
 */
function parseFrontMatter(raw) {
  if (!raw.startsWith('---')) return { data: {}, content: raw, raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { data: {}, content: raw, raw };
  const head = raw.slice(4, end);
  let content = raw.slice(end + 4);
  if (content.startsWith('\n')) content = content.slice(1);
  let data;
  try {
    data = parseYaml(head) || {};
  } catch (e) {
    data = {};
  }
  return { data: data || {}, content, raw };
}

module.exports = { parseFrontMatter, parseYaml, parseScalar };
