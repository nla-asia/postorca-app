const path = require("node:path");
const { bundle } = require("@remotion/bundler");

bundle({
  entryPoint: path.resolve(__dirname, "../../../remotion/index.ts"),
  outDir: path.resolve(__dirname, "../../../build/remotion"),
})
  .then((directory) => console.log(`Video templates bundled at ${directory}`))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
