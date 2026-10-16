"""KWGT 위젯 파일(.kwgt) 만들기 — A안: 오늘 현장 목록 + 줄마다 티맵.

사용: python3 build_kwgt.py "<웹앱주소>?w=<키>" 출력.kwgt [미리보기.png]
웹앱 주소에 개인 키가 들어가므로 만든 파일은 저장소에 올리지 않는다.
"""
import io, json, sys, zipfile

ROWS = 6
W = 324  # 줄 너비
BG, ROW, BLUE, FG, DIM = '#FF12161E', '#FF222834', '#FF4C8DFF', '#FFFFFFFF', '#FF8B95A5'


def wg(field):
    return 'wg(gv(u), json, .%s)' % field


def f(expr):
    return '$' + expr + '$'


def shape(w, h, color, corners=0, **kw):
    m = {'internal_type': 'ShapeModule', 'shape_type': 'RECT', 'shape_width': float(w),
         'shape_height': float(h), 'paint_color': color}
    if corners:
        m['shape_corners'] = float(corners)
    m.update(kw)
    return m


def text(expr, size, color=FG, **kw):
    m = {'internal_type': 'TextModule', 'text_expression': expr, 'text_size': float(size), 'paint_color': color}
    m.update(kw)
    return m


def link(url_expr):
    return [{'type': 'SINGLE_TAP', 'action': 'OPEN_LINK', 'url': url_expr}]


def overlap(items, **kw):
    m = {'internal_type': 'OverlapLayerModule', 'viewgroup_items': items}
    m.update(kw)
    return m


def dim(i, on, off):
    # 지난 현장(d#=1)은 흐리게
    return f('if(%s=1, "%s", "%s")' % (wg('d%d' % i), off, on))


def row(i):
    go = link(f(wg('t%d' % i)))
    return overlap([
        shape(W, 38, ROW, 9, internal_events=go),
        text(f(wg('h%d' % i)), 14, FG, position_anchor='CENTERLEFT', position_padding_left=10.0,
             internal_toggles={'paint_color': 10}, internal_formulas={'paint_color': dim(i, FG, '#66FFFFFF')}),
        text(f(wg('n%d' % i)), 14, FG, position_anchor='CENTERLEFT', position_padding_left=62.0,
             position_offset_y=-7.0, text_size_type='FIXED_WIDTH', text_width=200.0, text_lines=1.0,
             internal_toggles={'paint_color': 10}, internal_formulas={'paint_color': dim(i, FG, '#66FFFFFF')}),
        text(f(wg('s%d' % i)), 10, DIM, position_anchor='CENTERLEFT', position_padding_left=62.0,
             position_offset_y=9.0, internal_toggles={'paint_color': 10},
             internal_formulas={'paint_color': dim(i, DIM, '#558B95A5')}),
        shape(50, 26, BLUE, 7, position_anchor='CENTERRIGHT', position_padding_right=6.0, internal_events=go,
              internal_toggles={'paint_color': 10}, internal_formulas={'paint_color': dim(i, BLUE, '#664C8DFF')}),
        text('티맵', 12, FG, position_anchor='CENTERRIGHT', position_padding_right=18.0),
    ], internal_title='현장 %d' % i, internal_toggles={'config_visible': 10},
        internal_formulas={'config_visible': f('if(tc(len, %s)>0, ALWAYS, REMOVE)' % wg('n%d' % i))})


def button(label, url_expr, w):
    return overlap([shape(w, 32, ROW, 9, internal_events=link(url_expr)), text(label, 12, FG)])


def build(url):
    app = url.split('?')[0]
    header = overlap([
        # 머리글을 누르면 새로고침
        shape(W, 40, '#00000000', internal_events=[{'type': 'SINGLE_TAP', 'action': 'KUSTOM_ACTION', 'kustom_action': 'TEXT_UPDATE'}]),
        text(f('if(tc(len, %s)>0, %s, "일정 불러오는 중…")' % (wg('title'), wg('title'))), 15, FG,
             position_anchor='CENTERLEFT', position_offset_y=-9.0),
        text(f(wg('sub')), 11, DIM, position_anchor='CENTERLEFT', position_offset_y=10.0,
             text_size_type='FIXED_WIDTH', text_width=250.0, text_lines=1.0),
        text(f(wg('updated')), 10, DIM,
             position_anchor='CENTERRIGHT', position_offset_y=-9.0),
    ], internal_title='머리글')
    more = text('외 %s곳 더' % f('%s - %d' % (wg('count'), ROWS)), 11, DIM, internal_title='더보기',
                internal_toggles={'config_visible': 10},
                internal_formulas={'config_visible': f('if(%s>%d, ALWAYS, REMOVE)' % (wg('count'), ROWS))})
    footer = {'internal_type': 'StackLayerModule', 'config_stacking': 'HORIZONTAL_CENTER', 'config_margin': 8.0,
              'internal_title': '아래 버튼', 'viewgroup_items': [
                  button('하루 경로 · 카카오', f(wg('rk')), (W - 8) / 2),
                  button('웹앱 열기', app, (W - 8) / 2)]}
    body = {'internal_type': 'StackLayerModule', 'config_stacking': 'VERTICAL_CENTER', 'config_margin': 5.0,
            'internal_title': '목록', 'viewgroup_items': [header] + [row(i) for i in range(1, ROWS + 1)] + [more, footer]}
    return {
        'preset_info': {'version': 11, 'title': '오늘 현장', 'description': '오늘 검사 현장 목록. 줄을 누르면 티맵 길안내, 위쪽 제목을 누르면 새로고침.',
                        'author': '', 'email': '', 'width': 360, 'height': 400, 'features': 'DOWNLOAD',
                        'release': 353104016, 'locked': False, 'pflags': 0},
        'preset_root': {
            'internal_type': 'RootLayerModule',
            'globals_list': {
                'u': {'index': 0, 'type': 'TEXT', 'title': '내 위젯 주소', 'value': url},
            },
            'viewgroup_items': [shape(W + 20, 400, BG, 16, internal_title='배경',
                                      internal_toggles={'shape_height': 10},
                                      internal_formulas={'shape_height': f('97 + 43 * mu(min, %s, %d) + if(%s>%d, 20, 0)' % (
                                          wg('count'), ROWS, wg('count'), ROWS))}),
                                body],
        },
    }


def main():
    url, out = sys.argv[1], sys.argv[2]
    thumb = sys.argv[3] if len(sys.argv) > 3 else None
    preset = json.dumps(build(url), ensure_ascii=False, indent=1)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('preset.json', preset)
        if thumb:
            from PIL import Image
            im = Image.open(thumb).convert('RGB')
            for name in ('preset_thumb_portrait.jpg', 'preset_thumb_landscape.jpg'):
                b = io.BytesIO()
                im.save(b, 'JPEG', quality=85)
                z.writestr(name, b.getvalue())
    print(out, len(preset))


if __name__ == '__main__':
    main()
