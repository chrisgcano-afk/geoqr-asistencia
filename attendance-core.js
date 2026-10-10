(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.GeoQRCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    function dateOf(record) {
        const t = record.timestamp;
        if (t?.toDate) return t.toDate();
        if (t instanceof Date) return t;
        if (Number.isFinite(t?.seconds)) return new Date(t.seconds * 1000 + (t.nanoseconds || 0) / 1e6);
        return null;
    }
    function typeOf(type) { return type === 'Break' ? 'Break Start' : type === 'Lunch' ? 'Lunch Start' : type; }
    function sortedRecords(logs) {
        return logs.filter(r => !r.voided && dateOf(r) && Number.isFinite(+dateOf(r)))
            .slice().sort((a,b) => dateOf(a)-dateOf(b) || String(a.id||'').localeCompare(String(b.id||'')));
    }
    // Pair complete history first. Only then intersect each segment with the reporting period.
    function calculate(logs, start = -Infinity, end = Infinity, now = Date.now()) {
        start=+start; end=Math.min(+end,+now); now=+now;
        let shift=null, segmentStart=null, state='OFF', gross=0, breaks=0, lunch=0, shifts=0, open=false;
        const intervals=[];
        const addSegment=t=>{
            if(segmentStart===null)return;
            const ms=Math.max(0,Math.min(+t,end)-Math.max(segmentStart,start));
            gross+=ms;
            if(state==='BREAK')breaks+=ms;
            if(state==='LUNCH')lunch+=ms;
        };
        const closeShift=(t,isOpen)=>{
            addSegment(t);
            const a=Math.max(shift,start),b=Math.min(+t,end);
            if(b>a){intervals.push({start:a,end:b});shifts++;if(isOpen)open=true;}
            shift=null;segmentStart=null;state='OFF';
        };
        for(const r of sortedRecords(logs)) {
            const t=+dateOf(r),type=typeOf(r.type);
            if(t>now)continue;
            if(type==='Check-in' && shift===null){shift=t;segmentStart=t;state='WORKING';}
            else if(shift!==null && type==='Check-out')closeShift(t,false);
            else if(shift!==null){
                let next=null;
                if(state==='WORKING' && type==='Break Start')next='BREAK';
                if(state==='WORKING' && type==='Lunch Start')next='LUNCH';
                if(state==='BREAK' && type==='Break End')next='WORKING';
                if(state==='LUNCH' && type==='Lunch End')next='WORKING';
                if(next){addSegment(t);segmentStart=t;state=next;}
            }
        }
        if(shift!==null)closeShift(now,true);
        gross=Math.floor(gross/1000)*1000;breaks=Math.floor(breaks/1000)*1000;lunch=Math.floor(lunch/1000)*1000;
        return {grossMs:gross,breakMs:breaks,lunchMs:lunch,netMs:Math.max(0,gross-breaks-lunch),shifts,open,intervals};
    }
    function attendanceState(logs) {
        let state='OFF',checkIn=null;
        for(const row of sortedRecords(logs)) {
            const type=typeOf(row.type);
            if(type==='Check-in' && state==='OFF'){state='WORKING';checkIn=row;}
            else if(type==='Check-out'){state='OFF';checkIn=null;}
            else if(type==='Break Start' && state==='WORKING')state='BREAK';
            else if(type==='Lunch Start' && state==='WORKING')state='LUNCH';
            else if(type==='Break End' && state==='BREAK')state='WORKING';
            else if(type==='Lunch End' && state==='LUNCH')state='WORKING';
        }
        return {state,checkIn};
    }
    function dateKey(date, timeZone) {
        const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
        const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;
    }
    function addDays(key,n){const d=new Date(key+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
    function midnight(key,timeZone) {
        const target=Date.parse(key+'T00:00:00Z');let t=target;
        const formatter=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
        for(let i=0;i<5;i++){
            const p=Object.fromEntries(formatter.formatToParts(new Date(t)).map(x=>[x.type,x.value]));
            const seen=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
            const adjustment=target-seen;if(!adjustment)break;t+=adjustment;
        }
        return new Date(t);
    }
    function bounds(offset,timeZone,now=new Date()) {
        const today=dateKey(now,timeZone),day=new Date(today+'T12:00:00Z').getUTCDay();
        const monday=addDays(today,-((day+6)%7)+offset*7);
        return {start:midnight(monday,timeZone),end:midnight(addDays(monday,7),timeZone)};
    }
    function daysAttended(intervals,timeZone) {
        const days=new Set();
        for(const interval of intervals){
            let day=dateKey(new Date(interval.start),timeZone),last=dateKey(new Date(interval.end-1),timeZone);
            for(let i=0;day<=last && i<3700;i++,day=addDays(day,1))days.add(day);
        }
        return days.size;
    }
    return {dateOf,typeOf,sortedRecords,calculate,attendanceState,dateKey,addDays,midnight,bounds,daysAttended};
});
