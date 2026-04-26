const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const extDir = path.join(__dirname, 'extension');
const outDir = path.join(__dirname, 'build');

fs.mkdirSync(outDir, { recursive: true });

async function build() {
    await esbuild.build({
        entryPoints: [path.join(extDir, 'content.js')],
        bundle: true,
        outfile: path.join(outDir, 'content.js')
    });

    await esbuild.build({
        entryPoints: [path.join(extDir, 'background.js')],
        bundle: true,
        outfile: path.join(outDir, 'background.js')
    });

    fs.copyFileSync(
        path.join(extDir, 'manifest.json'),
        path.join(outDir, 'manifest.json')
    );
}

build().catch(err => {
    console.error(err);
    process.exit(1);
});
