import pkg from '../package.json';

/** kapi's version, from package.json — the single place a release bumps it (Cargo.toml and tauri.conf.json follow; see scripts/bump-version.mjs). */
export const KAPI_VERSION: string = pkg.version;
