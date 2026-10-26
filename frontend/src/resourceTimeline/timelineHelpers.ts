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

/** "04/10 → 31/10" in the business timezone (adds the year when it is not the current one); null when either end is missing. */
export function scheduleRange(start: string | null, finish: string | null, timeZone: string, now = new Date()): string | null {
  const parse = (value: string | null) => {
    if (!value || !Number.isFinite(Date.parse(value))) return null;
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, calendar: 'iso8601', numberingSystem: 'latn', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date(value));
    const pick = (type: string) => parts.find(part => part.type === type)?.value ?? '';
    return { day: pick('day'), month: pick('month'), year: pick('year') };
  };
  const from = parse(start); const to = parse(finish);
  if (!from || !to) return null;
  const currentYear = new Intl.DateTimeFormat('en-GB', { timeZone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric' }).format(now);
  const show = (date: { day: string; month: string; year: string }) => `${date.day}/${date.month}${date.year === currentYear ? '' : `/${date.year}`}`;
  return `${show(from)} → ${show(to)}`;
}

export type ScheduleInfo = { schedstart: string | null; schedfinish: string | null; pic: string | null };
export type AssignedPerson = { date: string; laborcode: string; name: string };
export type WoWarnings = { outsideDates: string[]; picNotAssigned: boolean };

/** Calendar day (YYYY-MM-DD) of an instant in the business timezone; null for a missing/invalid value. */
export function localDate(value: string | null, timeZone: string): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const pick = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

const samePerson = (left: string, right: string) => left.trim().toUpperCase() === right.trim().toUpperCase();

// Warnings never block anything: they only tell the planner the plan disagrees with Maximo's WO header.
export function woWarnings(info: ScheduleInfo | undefined, assigned: AssignedPerson[], timeZone: string): WoWarnings {
  if (!info || assigned.length === 0) return { outsideDates: [], picNotAssigned: false };
  const start = localDate(info.schedstart, timeZone); const finish = localDate(info.schedfinish, timeZone);
  const outsideDates = start && finish
    ? [...new Set(assigned.map(person => person.date).filter(date => date < start || date > finish))].sort()
    : [];
  // assignedto is a PERSON code and equals the labor code, so compare codes, never display names.
  const picNotAssigned = !!info.pic && !assigned.some(person => samePerson(person.laborcode, info.pic ?? ''));
  return { outsideDates, picNotAssigned };
}

/** First assigned person: earliest assignment day, ties broken by name. Null when nobody is assigned. */
export function suggestedPic(assigned: AssignedPerson[]): string | null {
  const sorted = [...assigned].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'vi') || a.laborcode.localeCompare(b.laborcode));
  return sorted[0]?.laborcode ?? null;
}

export type PlanItem = { id: string; person_id: string; date: string; plan_id?: string | null; workorder_id: string };
export type Lanes = {
  /** Vertical lane of each item inside its day cell; one plan keeps one lane across its days. */
  lane: Map<string, number>;
  /** Day-off cells that a plan crosses, drawn as a dashed link at the plan's lane. */
  bridges: Map<string, { plan: string; lane: number }[]>;
  /** `${plan}|${person}|${date}` for each plan day, bridges included. */
  joined: Set<string>;
};

/**
 * Packs each person's assignments into lanes (greedy by start day) so a multi-day plan is one aligned bar.
 * A plan whose consecutive days are separated only by days off (`isOff`) is bridged across them.
 */
export function computeLanes(items: PlanItem[], dates: string[], isOff: (personId: string, date: string) => boolean): Lanes {
  const result: Lanes = { lane: new Map(), bridges: new Map(), joined: new Set() };
  const position = new Map(dates.map((date, index) => [date, index]));
  const byPerson = new Map<string, PlanItem[]>();
  for (const item of items) if (position.has(item.date)) byPerson.set(item.person_id, [...(byPerson.get(item.person_id) ?? []), item]);
  for (const [person, list] of byPerson) {
    type Span = { key: string; start: number; end: number; ids: string[]; plan?: string };
    const spans: Span[] = [];
    const plans = new Map<string, PlanItem[]>();
    const seenDay = new Set<string>();
    for (const item of list) {
      const day = `${item.plan_id}|${item.date}`;
      if (item.plan_id && !seenDay.has(day)) { seenDay.add(day); plans.set(item.plan_id, [...(plans.get(item.plan_id) ?? []), item]); }
      else { const index = position.get(item.date)!; spans.push({ key: item.id, start: index, end: index, ids: [item.id] }); }
    }
    const bridgeDays: { date: string; plan: string; index: number }[] = [];
    for (const [plan, group] of plans) {
      const indexes = group.map(item => position.get(item.date)!).sort((a, b) => a - b);
      const bridged: number[] = [];
      for (let k = 1; k < indexes.length; k++) {
        const between = Array.from({ length: indexes[k] - indexes[k - 1] - 1 }, (_, n) => indexes[k - 1] + 1 + n);
        if (between.length && between.every(index => isOff(person, dates[index]))) bridged.push(...between);
      }
      for (const index of bridged) bridgeDays.push({ date: dates[index], plan, index });
      for (const item of group) result.joined.add(`${plan}|${person}|${item.date}`);
      for (const bridge of bridged) result.joined.add(`${plan}|${person}|${dates[bridge]}`);
      spans.push({ key: `plan:${plan}`, start: indexes[0], end: indexes[indexes.length - 1], ids: group.map(item => item.id), plan });
    }
    spans.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const laneEnds: number[] = [];
    const laneOfSpan = new Map<string, number>();
    for (const span of spans) {
      let lane = laneEnds.findIndex(end => end < span.start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = span.end;
      laneOfSpan.set(span.key, lane);
      for (const id of span.ids) result.lane.set(id, lane);
    }
    for (const bridge of bridgeDays) {
      const key = `${person}|${bridge.date}`;
      result.bridges.set(key, [...(result.bridges.get(key) ?? []), { plan: bridge.plan, lane: laneOfSpan.get(`plan:${bridge.plan}`)! }]);
    }
  }
  return result;
}

/** Colour slot (1-6) for a task stage; 0 is the neutral grey for any other task number. */
export const taskHue = (taskId: number | null | undefined): number => ({ 10: 4, 20: 2, 30: 3, 40: 1, 50: 5 } as Record<number, number>)[taskId ?? -1] ?? 0;
