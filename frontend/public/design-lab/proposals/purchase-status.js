/* Prototype-wide semantic status palette, independent of page/selection. */
function purchaseStatusTone(value){
 const text=String(value||'').trim();
 if(/异常|不合格|损坏|不符|退回|逾期|超时|延期/.test(text))return 'danger';
 if(/待|等待|临近|到期|紧急|未到|未齐|补发|补资料|催单|涨|变化/.test(text))return 'warning';
 if(/已完成|已关闭|已入库|已收货|已采纳|全部到货|已到货|验收合格/.test(text))return 'success';
 if(/在途|进行中|执行中|处理中|沟通中|运输中|交付中|质保|已提交|部分到货/.test(text))return 'info';
 return 'neutral';
}
function decoratePurchaseStatuses(root=document){
 root.querySelectorAll('[data-status],.md-item .state,.pill-state,.tag,.md-flag').forEach(e=>{e.dataset.statusTone=purchaseStatusTone(e.dataset.status||e.textContent)});
 root.querySelectorAll('.md-meta>div').forEach(e=>{const label=e.querySelector('span'),value=e.querySelector('strong');if(value&&label&&/^(当前状态|单据状态|项目状态|状态|审批阶段|交付剩余时间|质保剩余时间)$/.test(label.textContent.trim()))value.dataset.statusTone=purchaseStatusTone(value.textContent)});
}
const statusStyle=document.createElement('style');statusStyle.textContent=`

[data-status-tone=danger]{--status-ink:var(--status-danger);--status-fill:var(--status-danger-bg)}[data-status-tone=warning]{--status-ink:var(--status-warning);--status-fill:var(--status-warning-bg)}[data-status-tone=success]{--status-ink:var(--status-success);--status-fill:var(--status-success-bg)}[data-status-tone=info]{--status-ink:var(--status-info);--status-fill:var(--status-info-bg)}[data-status-tone=neutral]{--status-ink:var(--status-neutral);--status-fill:var(--status-neutral-bg)}
[data-status-tone]{color:var(--status-ink)!important}.md-item .state:before{content:'●';margin-right:5px;font-size:9px}.pill-state[data-status-tone]:before{color:var(--status-ink)}.tag[data-status-tone],.md-flag[data-status-tone]{background:var(--status-fill)}.error-msg,.red{color:var(--status-danger)}.line-price.invalid{border-color:var(--status-danger);background:var(--status-danger-bg)}.row-change{background:var(--status-warning-bg)}.md-form-result,.finish{color:var(--status-success);background:var(--status-success-bg)}.category-list button.active,.md-item.active{background:#edf3ff}.category-list button.active{border-left-color:#1f5fd0}.category-list button small[data-status]{display:flex;align-items:center;gap:5px}.category-list button small[data-status]:before{content:'●';font-size:9px}
`;document.head.appendChild(statusStyle);
const renderBeforeStatus=render;render=function(){renderBeforeStatus();decoratePurchaseStatuses()};
const showBeforeStatus=show;show=function(...args){showBeforeStatus(...args);decoratePurchaseStatuses()};
decoratePurchaseStatuses();
