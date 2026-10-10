# 암호 PDF 테스트 파일 (교차 확인용 — qpdf가 아닌 다른 구현(pypdf)으로 만든 것). 내용은 가짜 값만.
# 사용: python3 -m venv v && v/bin/pip install pypdf cryptography && v/bin/python make-pypdf-fixtures.py <출력 폴더>
#  - pypdf-aes256.pdf / pypdf-rc4-40.pdf : 사용자 비밀번호 pw1234
#  - pypdf-aes256-unicode.pdf            : 사용자 비밀번호 계약비번A1!@
#  - pypdf-owner-only-aes128.pdf         : 소유자 비밀번호만 (열 때 비밀번호 없음)
import sys
from pypdf import PdfWriter
from pypdf.generic import NameObject
out = sys.argv[1]
def base():
    w = PdfWriter()
    w.add_blank_page(width=200, height=200)
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject as N
    page = w.pages[0]
    font = DictionaryObject({N('/Type'): N('/Font'), N('/Subtype'): N('/Type1'), N('/BaseFont'): N('/Helvetica')})
    page[N('/Resources')] = DictionaryObject({N('/Font'): DictionaryObject({N('/F1'): w._add_object(font)})})
    s = DecodedStreamObject(); s.set_data(b'BT /F1 12 Tf 20 100 Td (Contract 010-1234-5678) Tj ET')
    page[N('/Contents')] = w._add_object(s)
    return w
cases = [
  ('plain', None, None, None),
  ('rc4_40', 'pw1234', 'owner', 'RC4-40'),
  ('rc4_128', 'pw1234', 'owner', 'RC4-128'),
  ('aes128', 'pw1234', 'owner', 'AES-128'),
  ('aes256', 'pw1234', 'owner', 'AES-256'),
  ('aes256_r5', 'pw1234', 'owner', 'AES-256-R5'),
  ('owner_only_aes128', '', 'owner', 'AES-128'),
  ('unicode_aes256', '계약비번A1!@', 'owner', 'AES-256'),
]
for name, user, owner, algo in cases:
    w = base()
    if algo: w.encrypt(user_password=user, owner_password=owner, algorithm=algo)
    w.write(f'{out}/{name}.pdf')
print('ok')
