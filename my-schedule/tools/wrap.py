"""index.html(화면 원본) → 실제로 내보내는 파일 두 개를 만든다.

- apps-script/Index.html : 구글 앱스 스크립트용 (Code.gs 가 GitHub에서 읽어 감)
- web.html               : Vercel용 (주소 / 로 열림, vercel.json 참고)

사용: python3 my-schedule/tools/wrap.py   (index.html 을 고친 뒤 매번)
"""
import os

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
s = open(os.path.join(root, 'index.html'), encoding='utf-8').read()
i = s.index('</style>') + len('</style>')
head = s[:i].replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '')
body = s[i:].lstrip('\n')
note = '<!-- my-schedule/index.html 에서 만든 파일입니다. 화면을 고칠 때는 그 파일을 고친 뒤 tools/wrap.py 로 다시 만드세요. -->\n'


def page(extra):
    return ('<!DOCTYPE html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n' + note + extra + head
            + '\n</head>\n<body>\n' + body + '</body>\n</html>\n')


open(os.path.join(root, 'apps-script', 'Index.html'), 'w', encoding='utf-8').write(page(''))
open(os.path.join(root, 'web.html'), 'w', encoding='utf-8').write(page(
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    '<meta name="robots" content="noindex">\n'))
print('Index.html, web.html')
