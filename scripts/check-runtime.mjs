if (Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error('cestOn requires the certified Node 24 LTS major.');
}
