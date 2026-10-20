// `require()` of markdown-it-typlet, an ES module, gets the plugin itself
// through its 'module.exports' export: Hexo loads the plugins its
// configuration names this way. Node 22.12 brought `require()` of ES modules.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.log(`skip  require of markdown-it-typlet: Node ${process.versions.node} can't require ES modules`);
} else {
  const plugin = require('markdown-it-typlet');
  if (typeof plugin !== 'function') throw new Error(`require('markdown-it-typlet') gave ${typeof plugin}, not the plugin`);
  import('markdown-it-typlet').then((module) => {
    if (module.default !== plugin) throw new Error("require('markdown-it-typlet') differs from the default export");
    console.log('ok    require markdown-it-typlet: the plugin');
  });
}
