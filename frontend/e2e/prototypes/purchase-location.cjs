const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('frontend/public/design-lab/proposals/purchase-location.js','utf8');
function page(href){const location={href};const ctx={URL,location,history:{replaceState(_,__,u){location.href=u}},tab:'todo',demo:{view:'待采购',role:'采购员',kind:'铝型材'},stageView:{待采购:'待采购',待叫车:'待叫车',待审批:'待审批',待验收:'待验收',验收异常:'退换货'},catalogs:{铝型材:[],伺服电机:[]},md:{todoId:'reject',project:'TX26007',po:'PO26013'},stageSelection:{id:''},teamScope:{approval:'PO26013'},render(){},window:{addEventListener(){}},document:{querySelector(){return{onchange(e){ctx.demo.role=e.target.value}}}}};vm.createContext(ctx);vm.runInContext(source,ctx);return ctx}
const c=page('http://localhost/purchase-workbench.html?preview=companion');
vm.runInContext("tab='issues';render()",c);const issues=page(c.location.href);assert.equal(issues.tab,'issues');assert.equal(new URL(issues.location.href).searchParams.get('preview'),'companion');
vm.runInContext("tab='tasks';demo.view='待叫车';demo.role='采购经理';stageSelection.id='car-booked';render()",c);const tasks=page(c.location.href);assert.equal(tasks.tab,'tasks');assert.equal(tasks.demo.view,'待叫车');assert.equal(tasks.demo.role,'采购经理');assert.equal(tasks.stageSelection.id,'car-booked');
const bad=page('http://localhost/purchase-workbench.html?tab=wrong&view=wrong&role=wrong');assert.equal(bad.tab,'todo');assert.equal(bad.demo.view,'待采购');assert.equal(bad.demo.role,'采购员');
console.log('PASS: refresh retains primary tab, task stage, role, selected record and preview parameter; invalid values fall back.');
