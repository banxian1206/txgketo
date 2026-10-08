/* Prototype-only controls live outside the product workspace. */
const previewTools=document.createElement('aside');previewTools.className='prototype-role-tools';previewTools.setAttribute('aria-label','样机演示工具');previewTools.appendChild(document.getElementById('demo-role').closest('label'));document.body.appendChild(previewTools);
roleDemo.remove();
const previewToolsStyle=document.createElement('style');previewToolsStyle.textContent=`
body{padding-top:36px}.prototype-role-tools{position:fixed;right:16px;top:5px;z-index:30;background:#f9fbff;border:1px solid #e1e7f0;border-radius:8px;padding:3px 8px;box-shadow:0 2px 8px #20365208}.prototype-role-tools label{display:flex;align-items:center;gap:7px;font-size:11px;color:#7a879a}.prototype-role-tools select{font-size:11px;line-height:1.4;height:24px;padding:2px 5px;border:1px solid #dee5ef;border-radius:5px;background:white;color:#51647e}@media(max-width:720px){.prototype-role-tools{right:10px}}
`;document.head.appendChild(previewToolsStyle);
