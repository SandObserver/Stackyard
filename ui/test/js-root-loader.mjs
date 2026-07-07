/* Test-only module loader. The frontend source imports peers by their served
   path, e.g. import ... from '/js/utils.js?v=abcd1234'. Node's default resolver
   cannot follow a server-absolute path or a ?v= cache tag, so tests that import
   any module which in turn imports a peer would fail to resolve it. This hook
   maps '/js/<name>.js[?v=...]' to the file on disk under ui/js/. It only affects
   the test runner (wired via --import in the frontend test command); nothing
   here ships, and the browser resolves these paths natively through nginx. */
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
