/* Keep prototype navigation in the URL; demo business records still reset. */
const purchaseLocationTabs=['todo','tasks','projects','issues'];
const purchaseLocationRoles=['采购员','采购经理','采购总监','仓库手机端'];
const purchaseLocationViews=[...Object.values(stageView),'采购单','催到货'];
function restorePurchaseLocation(){
 const q=new URL(location.href).searchParams;
 tab=purchaseLocationTabs.includes(q.get('tab'))?q.get('tab'):'todo';
 demo.view=purchaseLocationViews.includes(q.get('view'))?q.get('view'):'待采购';
 demo.kind=Object.hasOwn(catalogs,q.get('kind'))?q.get('kind'):'铝型材';
 for(const key of ['todoId','todoGroup','project','po'])if(q.get(key))md[key]=q.get(key);
 stageSelection.id=q.get('record')||'';
 teamScope.approval=q.get('approval')||teamScope.approval;
 const role=q.get('role');
 if(purchaseLocationRoles.includes(role)){
  document.querySelector('#demo-role').value=role;
  document.querySelector('#demo-role').onchange({target:{value:role}});
 }
}
const renderBeforeLocation=render;
render=function(){
 renderBeforeLocation();
 const u=new URL(location.href);
 const nav={tab,view:demo.view,role:demo.role,kind:demo.kind,todoId:md.todoId,todoGroup:md.todoGroup,approval:teamScope.approval,project:md.project,po:md.po,record:stageSelection.id};
 for(const [key,value] of Object.entries(nav))if(value)u.searchParams.set(key,value);else u.searchParams.delete(key);
 if(u.href!==location.href)history.replaceState(null,'',u.href);
};
restorePurchaseLocation();render();
window.addEventListener('popstate',()=>{restorePurchaseLocation();render()});
