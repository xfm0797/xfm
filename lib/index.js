'use strict';
/**
 * xfm 编程式 API
 *
 *   const { build, createSite } = require('xfm');
 *   await build('./my-site');
 */

const path = require('path');
const { loadConfig } = require('./engine/config');
const { Site } = require('./engine/site');
const { renderMarkdown } = require('./engine/markdown');
const { compile } = require('./engine/template');
const { DevServer } = require('./engine/server');

/**
 * 构建站点
 * @param {string} root 站点根目录
 * @param {{mode?:'production'|'development'}} opts
 * @returns {Promise<Site>}
 */
async function build(root, opts = {}) {
  const abs = path.resolve(root || process.cwd());
  const config = await loadConfig(abs);
  const site = new Site(config, abs, { mode: opts.mode || 'production' });
  await site.init();
  await site.build();
  return site;
}

/** 仅构建到内存（不写盘），用于测试或自定义输出 */
async function compileSite(root) {
  const abs = path.resolve(root || process.cwd());
  const config = await loadConfig(abs);
  const site = new Site(config, abs, { mode: 'development' });
  await site.init();
  await site.collect();
  await site.prepare();
  await site.renderAll();
  return site;
}

async function dev(root, opts = {}) {
  const dev = new DevServer(path.resolve(root || process.cwd()), opts);
  return dev.start();
}

module.exports = {
  build,
  compileSite,
  dev,
  renderMarkdown,
  compileTemplate: compile,
  loadConfig,
  Site,
};
