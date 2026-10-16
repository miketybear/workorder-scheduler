import { displayHours, displayRole } from './timelineHelpers';
import styles from './ResourceTimeline.module.css';

export function RoleDonut({role,people,load,capacity,verified}:{role:string;people:number;load:number;capacity:number;verified:boolean}){
  const percentage=people>0&&verified&&capacity>0?Math.max(0,load/capacity*100):null;
  const ringPercentage=percentage===null?null:Math.min(100,percentage);
  const accessibleSummary=people===0?'Không có người trong nhóm':!verified?'Tải chưa xác minh':capacity===0?'Không có capacity trong tháng':`Tải ${Math.round(percentage??0)}% · ${displayHours(load)} / ${displayHours(capacity)} giờ${load>capacity?` · vượt ${displayHours(load-capacity)} giờ`:''}`;
  const title=`${displayRole(role)} · ${people} người · ${accessibleSummary}`;
  return <article className={styles.roleDonut} aria-label={title}>
    <div className={styles.roleHeading}><strong>{displayRole(role)}</strong>{percentage!==null&&<span className={styles.rolePercent} data-over={percentage>100||undefined}>{Math.round(percentage)}%</span>}</div>
    <div className={styles.roleBar} aria-hidden="true">{ringPercentage!==null&&ringPercentage>0&&<i data-fill style={{width:`${ringPercentage}%`}}/>}</div>
    <div><small>{people} người</small><small>{accessibleSummary}</small>{verified&&capacity>0&&load>capacity&&<small className={styles.overCapacity}>Vượt capacity {displayHours(load-capacity)} giờ</small>}</div>
  </article>;
}
