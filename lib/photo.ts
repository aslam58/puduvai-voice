export async function preparePhoto(file:File):Promise<string>{
 if(file.size>10485760 || !['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('image');
 const bitmap=await createImageBitmap(file);
 try{const scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');if(!ctx)throw new Error('image');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.8).split(',')[1];}finally{bitmap.close()}
}
export async function uploadPhoto(id:string,file:File){const base64=await preparePhoto(file);const r=await fetch(`/api/reports/${id}/photo`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base64})});if(!r.ok)throw new Error('photo');}
