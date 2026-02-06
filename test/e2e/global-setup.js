const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

module.exports = async function globalSetup() {
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
    execSync('node test/e2e/build-extension.js', {
        cwd: ROOT,
        stdio: 'inherit'
    });
};
