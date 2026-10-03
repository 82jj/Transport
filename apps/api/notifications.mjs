// Durable decision notifications. "accepted" means accepted by the provider, not delivered to the device.
export function notificationConfiguration(env=process.env){return {sms:!!(env.UNIFONIC_APPSID&&env.UNIFONIC_SENDER_ID),email:!!(env.RESEND_API_KEY&&env.EMAIL_FROM)};}
export async function sendNotification(channel,message,id,{env=process.env,fetcher=fetch}={}){
 const configured=notificationConfiguration(env);if(!configured[channel])return {state:'blocked',error:'provider_not_configured'};
 let response,data;
 try{
  if(channel==='email'){
   response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`wasil-captain-${id}`},body:JSON.stringify({from:env.EMAIL_FROM,to:[message.to],subject:message.subject,text:message.body}),signal:AbortSignal.timeout(15000),redirect:'error'});
  }else{
   const body=new URLSearchParams({AppSid:env.UNIFONIC_APPSID,SenderID:env.UNIFONIC_SENDER_ID,Recipient:message.to.replace(/^\+/,''),Body:message.body,responseType:'JSON',CorrelationID:id,async:'false'});
   response=await fetcher('https://el.cloud.unifonic.com/rest/SMS/messages',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body,signal:AbortSignal.timeout(15000),redirect:'error'});
  }
  data=await response.json();
 }catch{return {state:'unknown',error:'delivery_outcome_unknown'};}
 if(response.ok&&(channel==='email'?typeof data.id==='string':data.success===true&&data.data?.MessageID!=null))return {state:'accepted',providerId:String(channel==='email'?data.id:data.data.MessageID)};
 if(response.status===429)return {state:'queued',error:'provider_rate_limited'};
 // Do not blindly retry ambiguous failures: an SMS may already have been sent.
 return {state:'failed',error:response.status===401||response.status===403?'provider_authentication_failed':'provider_rejected'};
}
export function startNotificationWorker(db,onboarding,{env=process.env,fetcher=fetch}={}){
 db.prepare("UPDATE notification_outbox SET state='unknown',last_error='worker_restarted_during_send' WHERE state='sending'").run();
 let running=false,stopped=false;
 async function run(){if(running||stopped)return;running=true;try{
  const config=notificationConfiguration(env);
  for(const row of db.prepare("SELECT * FROM notification_outbox WHERE state IN ('queued','blocked') AND next_attempt<=? ORDER BY created_at LIMIT 10").all(Date.now())){
   if(!config[row.channel]){db.prepare("UPDATE notification_outbox SET state='blocked',last_error='provider_not_configured',next_attempt=? WHERE id=?").run(Date.now()+60000,row.id);continue;}
   if(row.attempts>=5){db.prepare("UPDATE notification_outbox SET state='failed',last_error='retry_limit' WHERE id=?").run(row.id);continue;}
   const claimed=db.prepare("UPDATE notification_outbox SET state='sending',attempts=attempts+1 WHERE id=? AND state IN ('queued','blocked')").run(row.id);if(!claimed.changes)continue;
   const result=await sendNotification(row.channel,onboarding.decode(row.payload),row.id,{env,fetcher});
   db.prepare('UPDATE notification_outbox SET state=?,provider_id=?,last_error=?,next_attempt=? WHERE id=?').run(result.state,result.providerId||null,result.error||null,Date.now()+Math.min(3600000,60000*2**row.attempts),row.id);
  }
 }finally{running=false;}}
 const timer=setInterval(()=>run().catch(()=>{}),5000);timer.unref();run().catch(()=>{});
 return {run,stop:()=>{stopped=true;clearInterval(timer);}};
}
