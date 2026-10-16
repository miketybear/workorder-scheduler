import type { CapacityDay, ResourcePerson } from '../api/assignments';

export const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
export const monthOf = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(date);
  return `${parts.find(x => x.type === 'year')?.value}-${parts.find(x => x.type === 'month')?.value}`;
};
export const addMonth = (month: string) => { const [year, number] = month.split('-').map(Number); return `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2, '0')}`; };
export const monthDates = (month: string) => { const [year, number] = month.split('-').map(Number); const count = new Date(Date.UTC(year, number, 0)).getUTCDate(); return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`); };
export function addCalendarDays(value:string,amount:number){
  let [year,monthNumber,day]=value.split('-').map(Number);const leap=(y:number)=>y%4===0&&(y%100!==0||y%400===0);const monthLength=(y:number,m:number)=>[31,leap(y)?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
  for(let step=0;step<amount;step++){day++;if(day>monthLength(year,monthNumber)){day=1;monthNumber++;if(monthNumber>12){monthNumber=1;year++;}}}
  return `${String(year).padStart(4,'0')}-${String(monthNumber).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
export function calendarRange(start:string,end:string,max=366){const dates:string[]=[];let current=start;while(current<=end&&dates.length<max){dates.push(current);current=addCalendarDays(current,1);}return current<=end?[]:dates;}
export const displayHours = (minutes: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(minutes / 60);
export const displayDate = (date:string) => { const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date); return match?`${match[3]}/${match[2]}/${match[1]}`:date; };
export function formatMaximoDateTime(value:string|null,timezone:string){if(!value)return '—';if(/^\d{4}-\d{2}-\d{2}$/.test(value))return displayDate(value);if(!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value))return '—';const parsed=new Date(value);if(!Number.isFinite(parsed.getTime()))return '—';return new Intl.DateTimeFormat('vi-VN',{timeZone:timezone,dateStyle:'short',timeStyle:'short'}).format(parsed);}
export function expectedFinish(value:string|null,hours:number|null,timezone:string){if(!value||hours===null||!Number.isFinite(hours)||/^\d{4}-\d{2}-\d{2}$/.test(value)||!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value))return '—';const start=new Date(value);if(!Number.isFinite(start.getTime()))return '—';return new Intl.DateTimeFormat('vi-VN',{timeZone:timezone,dateStyle:'short',timeStyle:'short'}).format(new Date(start.getTime()+hours*60*60_000));}
export const parseHours = (hours: string) => { const value = Number(hours) * 60; const rounded = Math.round(value); return Number.isFinite(value) && value>=0 && Math.abs(value - rounded) < 0.000001 ? rounded : 0; };
export const displayRole = (role: string) => ({ TECH: 'Technician', SUP: 'Supervisor', ASST_SUP: 'Assistant Supervisor', CONTROL_RM_ENGINEER: 'Control RM Engineer', MATERIAL_CONTROLLER: 'Material Controller' }[role] ?? role);
export const capacityFor = (person: ResourcePerson, date: string) => person.days.find(day => day.date === date);
export function suggestTaskPlans(tasks:Array<{key:string;taskId:number;minutes:number}>,days:CapacityDay[],start:string){
  const orderedDays=days.filter(day=>day.date>=start).sort((a,b)=>a.date.localeCompare(b.date));
  const remainingByDay=new Map(orderedDays.map(day=>[day.date,day.load_complete===true?Math.max(0,Math.min(630,day.capacity_minutes)-day.allocated_minutes):0]));
  const plans:Record<string,Record<string,number>>={};
  let blocked=false;
  for(const task of [...tasks].sort((a,b)=>a.taskId-b.taskId||a.key.localeCompare(b.key))){
    let remaining=task.minutes;const segments:Record<string,number>={};
    for(const day of orderedDays){if(remaining<=0)break;if(day.load_complete!==true){blocked=true;break;}const available=remainingByDay.get(day.date)??0;const allocated=Math.min(remaining,available);if(allocated>0){segments[day.date]=allocated;remainingByDay.set(day.date,available-allocated);remaining-=allocated;}}
    plans[task.key]=segments;
    if(blocked)break;
  }
  return {plans,blocked,unplaced:tasks.reduce((sum,task)=>sum+task.minutes,0)-Object.values(plans).flatMap(Object.values).reduce((sum,minutes)=>sum+minutes,0),end:[...remainingByDay.keys()].at(-1)??start};
}
export function todayIn(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export const subMonth = (month: string) => { const [year, number] = month.split('-').map(Number); return `${number === 1 ? year - 1 : year}-${String(number === 1 ? 12 : number - 1).padStart(2, '0')}`; };
