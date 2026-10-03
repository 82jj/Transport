export const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
export const TERMS='wasil-captain-2026-10-03';
export function captainData(email='captain@example.test',suffix=1,selected=['light','heavy']){return {email,phone:'050'+String(suffix).padStart(7,'0'),fullName:'أحمد محمد عبدالله التجريبي',identityNumber:'1'+String(suffix).padStart(9,'0'),vehicle:{type:'بيك أب',model:'مركبة اختبار',year:2024,vin:'JT123456789012345'},categories:selected,licenseExpiry:'2090-01-01',registrationExpiry:'2090-01-01',insuranceExpiry:'2090-01-01'};}
