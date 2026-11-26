import { build } from 'esbuild';
import { WgslReflect } from '../node_modules/wgsl_reflect/wgsl_reflect.module.js';

const result = await build({
  entryPoints: ['src/gpu/shaders.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  target: 'es2022',
});
const code = result.outputFiles[0].text;
const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

let failed = false;
for (const [name, source] of Object.entries(mod)) {
  if (typeof source !== 'string') continue;
  try {
    const reflect = new WgslReflect(source);
    console.log(`PARSE_OK ${name}: ${source.length} chars, ${reflect.entry?.length ?? 0} entries`);
  } catch (error) {
    failed = true;
    console.error(`PARSE_FAIL ${name}`);
    console.error(error.message || error);
  }
}
if (failed) process.exit(1);
