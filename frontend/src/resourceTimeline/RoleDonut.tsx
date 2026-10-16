import { displayHours, displayRole } from './timelineHelpers';
import styles from './ResourceTimeline.module.css';

export function RoleDonut({role,people,load,capacity,verified}:{role:string;people:number;load:number;capacity:number;verified:boolean}){
  const percentage=people>0&&verified&&capacity>0?Math.max(0,load/capacity*100):null;
  const ringPercentage=percentage===null?null:Math.min(100,percentage);
  const accessibleSummary=people===0?'Không có người trong nhóm':!verified?'Tải chưa xác minh':capacity===0?'Không có capacity trong tháng':`Tải ${Math.round(percentage??0)}% · ${displayHours(load)} / ${displayHours(capacity)} giờ${load>capacity?` · vượt ${displayHours(load-capacity)} giờ`:''}`;
  const title=`${displayRole(role)} · ${people} người · ${accessibleSummary}`;
  const circumference=2*Math.PI*24;
  return <article className={styles.roleDonut} aria-label={title}>
    <svg viewBox="0 0 64 64" aria-hidden="true"><circle className={styles.donutTrack} cx="32" cy="32" r="24"/>{ringPercentage!==null&&ringPercentage>0&&<circle className={styles.donutValue} cx="32" cy="32" r="24" strokeDasharray={`${circumference*ringPercentage/100} ${circumference}`}/>}<text x="32" y="35" textAnchor="middle">{percentage===null?'—':`${Math.round(percentage)}%`}</text></svg>
    <div><strong>{displayRole(role)}</strong><small>{people} người</small><small>{accessibleSummary}</small>{verified&&capacity>0&&load>capacity&&<small className={styles.overCapacity}>Vượt capacity {displayHours(load-capacity)} giờ</small>}</div>
  </article>;
}
