import fs from 'node:fs';
fs.mkdirSync('dist',{recursive:true});
fs.cpSync('public','dist',{recursive:true});
fs.copyFileSync('src/initial-settings.json','dist/initial-settings.json');
fs.mkdirSync('dist/rules',{recursive:true});
for(const filename of ['rules.mjs','office-knowledge.mjs','tryze-faq.mjs']){
  fs.copyFileSync('src/'+filename,'dist/rules/'+filename);
}
const page=fs.readFileSync('dist/index.html','utf8').replace(/(href|src)="\/(?!\/)/g,'$1="./');
fs.writeFileSync('dist/index.html',page);
fs.writeFileSync('dist/.nojekyll','');
