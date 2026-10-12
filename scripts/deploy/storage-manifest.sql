-- 읽기 전용 (SELECT 한 문장). Storage 파일 목록(경로·크기·eTag)을 뽑아 내려받은 파일과 대조하는 기준으로 쓴다.
--   npx supabase db query --linked -o csv -f scripts/deploy/storage-manifest.sql | Out-File -Encoding utf8 <백업 폴더>\storage-manifest.csv
-- 경로는 "<사용자 id>/<문서 id>.<확장자>" 형식이라 파일 원래 이름·계약 내용은 없지만 사용자 id가 들어 있다
-- → 이 CSV도 백업 폴더에만 두고 채팅·git에 올리지 않는다.
-- eTag: 한 번에 올린 파일이면 보통 내용의 md5와 같다. 여러 조각으로 올린 파일은 "md5-조각수" 형식이라 크기만 비교한다.
select o.bucket_id,
  o.name,
  (o.metadata->>'size')::bigint as size,
  trim(both '"' from o.metadata->>'eTag') as etag
from storage.objects o
order by o.bucket_id, o.name collate "C";
