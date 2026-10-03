import {readdir} from 'node:fs/promises';import {spawnSync} from 'node:child_process';
async function check(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=`${directory}/${entry.name}`;if(entry.isDirectory()){if(entry.name!=='data')await check(path);}else if(/\.(js|mjs)$/.test(entry.name)){const result=spawnSync(process.execPath,['--check',path],{stdio:'inherit'});if(result.status)process.exit(result.status);}}}
await check('apps');await check('tests');console.log('All JavaScript syntax checks passed');
