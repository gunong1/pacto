"""
사진 계약서 보호 테스트용 fixture 만들기 (모든 개인정보는 가짜 값).
- lease-a4.jpg: 같은 내용을 A4 비율 전체 크기(2400×3391)로 — 성능 측정용
- lease.jpg (2400px): 주택 월세 임대차계약서 형태 — 주민번호 2 · 전화 2 · 계좌 3 · 카드 1 + 오탐 후보(계약번호·등록번호·사업자번호·금액·날짜·주소·면적)
- lease.clova.json: 위 이미지에 대한 CLOVA OCR General V2 형식 응답 (단어 단위 필드 · 좌표 · lineBreak)
  · 임대인 줄의 필드명은 OCR 오타 "주민동록번호"로, 카드번호는 "1234-" "5678-" "9012-" "3456" 네 조각으로 나눠 넣는다
- smallprint.jpg (2400px): 작은 글자(약 6pt·8pt·10pt 상당) — 1600px 보호본 가독성 확인용
- blurry.clova.json: 흐린 사진처럼 거의 읽지 못한 응답 (unreadable)
- plain.jpg / plain.clova.json: 민감정보 없는 문서
사용: python3 scripts/fixtures/make-photo-fixtures.py  (PIL, WenQuanYi Zen Hei 글꼴 필요)
"""
import json, os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', '__fixtures__', 'photo')
FONT = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
W = 2400

def render(rows, height, size=38, x0=120, gap=74, y0=120):
    """rows: [[(text, ocr_override_or_None, split_list_or_None), ...], ...] — 한 줄에 여러 칸"""
    img = Image.new('RGB', (W, height), (250, 250, 247))
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, size)
    fields = []
    y = y0
    for row in rows:
        x = x0
        row_fields = []
        for cell in row:
            text, ocr_text, split = cell
            words = text.split(' ')
            ocr_words = (ocr_text or text).split(' ')
            for wi, word in enumerate(words):
                bb = d.textbbox((x, y), word, font=font)
                d.text((x, y), word, fill=(20, 20, 20), font=font)
                ow = ocr_words[wi] if wi < len(ocr_words) else word
                if split and word in split:
                    # 한 단어를 여러 OCR 조각으로 (붙어 있는 좌표)
                    cx = bb[0]
                    for part in split[word]:
                        pb = d.textbbox((cx, y), part, font=font)
                        row_fields.append({'text': part, 'box': [pb[0], bb[1], pb[2], bb[3]]})
                        cx = pb[2]
                else:
                    row_fields.append({'text': ow, 'box': list(bb)})
                x = bb[2] + int(size * 0.45)
            x += int(size * 1.6)
        for i, f in enumerate(row_fields):
            fields.append({**f, 'lineBreak': i == len(row_fields) - 1})
        y += gap
    return img, fields

def clova(fields, conf=0.99):
    return {'version': 'V2', 'requestId': 'fixture', 'timestamp': 0, 'images': [{'uid': 'f', 'name': 'page', 'inferResult': 'SUCCESS', 'message': 'SUCCESS',
        'fields': [{'valueType': 'ALL', 'inferText': f['text'], 'inferConfidence': f.get('conf', conf), 'type': 'NORMAL', 'lineBreak': f['lineBreak'],
                    'boundingPoly': {'vertices': [{'x': f['box'][0], 'y': f['box'][1]}, {'x': f['box'][2], 'y': f['box'][1]}, {'x': f['box'][2], 'y': f['box'][3]}, {'x': f['box'][0], 'y': f['box'][3]}]}}
                   for f in fields]}]}

def c(t, o=None, s=None):
    return (t, o, s)

LEASE = [
    [c('주택 월세 임대차계약서')],
    [c('계약번호 2026-1234-5678-0001')],
    [c('1. 계약 당사자')],
    [c('임대인 성명 김민수'), c('주민등록번호 800101-1234567', '주민동록번호 800101-1234567')],
    [c('주소 대전광역시 서구 둔산로 10, 101동 201호')],
    [c('연락처 010-1234-5678')],
    [c('임차인 성명 박지훈'), c('주민등록번호 950505-2345678')],
    [c('주소 대전광역시 유성구 대학로 50, 102동 303호')],
    [c('연락처 010-9876-5432')],
    [c('2. 목적물 전용면적 39.8㎡ 사용승인일 2018년 5월 10일')],
    [c('3. 계약기간 2026년 10월 20일 ~ 2028년 10월 19일 (2년간)')],
    [c('보증금 20,000,000원 계약금 2,000,000원 잔금 18,000,000원')],
    [c('월세 850,000원 관리비 100,000원 지급일 매월 20일')],
    [c('보증금 반환계좌 국민은행 123-456-789012')],
    [c('월세 입금계좌 신한은행 987-654-321098')],
    [c('관리비 입금계좌 우리은행 1002-345-678901')],
    [c('자동이체 카드번호 1234-5678-9012-3456', None, {'1234-5678-9012-3456': ['1234-', '5678-', '9012-', '3456']})],
    [c('중개사무소 사업자등록번호 123-45-67890')],
    [c('중개사 등록번호 제 30170-2020-000123 호')],
    [c('2026년 10월 8일 PACTO 테스트용 가짜 샘플')],
]

PLAIN = [
    [c('헬스장 회원 이용 계약서')],
    [c('계약번호 2026-1234-5678-0001')],
    [c('이용기간 2026년 1월 1일 ~ 2026년 12월 31일')],
    [c('월 이용료 55,000원 매월 5일 결제')],
    [c('락커 이용 시 월 5,000원 (선택)')],
    [c('회원권 양도 시 수수료 30,000원')],
    [c('주소 대전광역시 서구 둔산로 200, 1층')],
    [c('PACTO 테스트용 가짜 샘플')],
]

def save(name, img, fields):
    img.save(os.path.join(OUT, f'{name}.jpg'), quality=85)
    with open(os.path.join(OUT, f'{name}.clova.json'), 'w') as f:
        json.dump(clova(fields), f, ensure_ascii=False)

os.makedirs(OUT, exist_ok=True)
img, fields = render(LEASE, 1700)
save('lease', img, fields)
# A4 비율 전체 크기 (2400×3391) — 실제 휴대폰 사진 크기에서 성능 측정용
img, fields = render(LEASE, 3391, size=60, gap=160, y0=200)
save('lease-a4', img, fields)
img, fields = render(PLAIN, 800)
save('plain', img, fields)
# 흐린 사진: 몇 글자만 낮은 신뢰도로
with open(os.path.join(OUT, 'blurry.clova.json'), 'w') as f:
    json.dump(clova([{'text': '계약', 'box': [100, 100, 200, 140], 'lineBreak': False, 'conf': 0.31}, {'text': '서', 'box': [210, 100, 250, 140], 'lineBreak': True, 'conf': 0.22}]), f)

# 작은 글자 가독성: A4 사진을 2400px로 찍었다고 보면 1pt ≈ 4.0px (글자 크기 = pt × 4). 6pt·8pt·10pt
small = Image.new('RGB', (W, 1000), (250, 250, 247))
d = ImageDraw.Draw(small)
y = 80
for pt in (6, 8, 10):
    f = ImageFont.truetype(FONT, pt * 4)
    d.text((120, y), f'{pt}pt 상당: 임차인은 계약 종료 60일 전까지 갱신 여부를 협의한다. 보증금 20,000,000원 · 연락처 010-1234-5678', fill=(20, 20, 20), font=f)
    y += pt * 4 + 60
small.save(os.path.join(OUT, 'smallprint.jpg'), quality=85)
print('fixtures written to', os.path.abspath(OUT))
