/* Last deferred script: reveal only the fully initialized prototype. */
if(window.purchasePrototypeBootErrors.length){
 window.showPurchasePrototypeBootError();
}else{
 requestAnimationFrame(()=>{
  if(window.purchasePrototypeBootErrors.length)window.showPurchasePrototypeBootError();
  else document.documentElement.removeAttribute('data-prototype-loading');
 });
}
