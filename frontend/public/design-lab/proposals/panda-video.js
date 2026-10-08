/* Video-derived frames, one common canvas and scale throughout. */
function createPandaVideo(host){
 host.innerHTML='<canvas class="panda-visual" width="380" height="380" role="img" aria-label="视频中的毛绒熊猫正在吃竹子"></canvas>';
 const canvas=host.querySelector('canvas'),ctx=canvas.getContext('2d');ctx.setTransform(2,0,0,2,0,0);
 const frames=141,fps=24,perSheet=48,columns=8,w=256,h=276;
 const images=Array.from({length:3},(_,i)=>{const img=new Image();img.src='assets/panda-video-v2/atlas-'+i+'.webp';img.onerror=()=>{host.dataset.assetError=String(i)};return img});
 // Return along the continuous original motion instead of jumping from the last pose to the first.
 const sequence=[...Array(12).fill(0),...Array.from({length:frames},(_,i)=>i),...Array(12).fill(frames-1),...Array.from({length:frames-2},(_,i)=>frames-2-i)];
 let lastTime=null,elapsed=0,lastFrame=-1;
 function tick(now,visible=true){
  const ready=images.every(im=>im.complete&&im.naturalWidth>0);
  if(lastTime!==null&&visible&&ready)elapsed+=Math.max(0,Math.min(.1,(now-lastTime)/1000));
  lastTime=now;if(!ready)return;
  const frame=sequence[Math.floor(elapsed*fps)%sequence.length];if(frame===lastFrame)return;
  const local=frame%perSheet,scale=190/h,dw=w*scale;
  ctx.clearRect(0,0,190,190);ctx.drawImage(images[Math.floor(frame/perSheet)],local%columns*w,Math.floor(local/columns)*h,w,h,(190-dw)/2,0,dw,190);
  canvas.dataset.frame=String(frame);lastFrame=frame;host.dataset.action='video-eat';
 }
 return {tick};
}
