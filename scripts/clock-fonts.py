#!/usr/bin/env python3
"""Rebuild the Captain clock fonts in ui/widgets/clock/fonts.

Needs fontTools and brotli: pip install fonttools brotli
Run it after a change to a Captain string in ui/widgets/clock/i18n.
"""

import hashlib
import io
import json
import pathlib
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'ui' / 'widgets' / 'clock' / 'fonts'
I18N = ROOT / 'ui' / 'widgets' / 'clock' / 'i18n'
SOURCE = 'https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl'

FONTS = {
    'patrickhand': ('PatrickHand-Regular.ttf', '0f173b3e6cb6d1af25babf7f0057c5ac4ee11f9992b0469bb817e967ef4ad0fc'),
    'vazirmatn': ('Vazirmatn%5Bwght%5D.ttf', '696249a2c74b39ffdef55de4df2809c5b639d3ff80d618d8160a095d2fd49dca'),
    'zcoolkuaile': ('ZCOOLKuaiLe-Regular.ttf', '812a6fc1fe54b6d73a419245c32dfeba8aa33104d5be90d1cf6af082007cb71d'),
}

LATIN = [*range(0x20, 0x7F), *range(0xA0, 0x100), 0x152, 0x153, 0x178, *range(0x2018, 0x201F), 0x2026]
PERSIAN = [0x20, 0x21, 0x3A, *range(0x600, 0x700), 0x200C, 0x200D, 0x2026]
# Chinese weekday and date characters come from Intl at run time, not from the catalog.
CHINESE_INTL = '星期日一二三四五六年月0123456789'


def fetch(url):
    with urllib.request.urlopen(url) as r:
        return r.read()


def source(name):
    file, sha = FONTS[name]
    data = fetch(f'{SOURCE}/{name}/{file}')
    if hashlib.sha256(data).hexdigest() != sha:
        raise SystemExit(f'{name}: the downloaded font does not match its checksum')
    (OUT / f'OFL-{name}.txt').write_bytes(fetch(f'{SOURCE}/{name}/OFL.txt'))
    return TTFont(io.BytesIO(data))


def write(font, unicodes, out):
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = ['*']
    options.hinting = False
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    font.flavor = 'woff2'
    font.save(OUT / out)
    print(f'{out}: {(OUT / out).stat().st_size} bytes')


def chinese():
    cat = json.loads((I18N / 'zh-Hans.json').read_text(encoding='utf-8'))
    text = cat['ui.captainLine'].replace('{weekday}', '') + cat['ui.captainLoading'] + CHINESE_INTL
    return sorted({ord(c) for c in text})


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    write(source('patrickhand'), LATIN, 'patrick-hand.woff2')
    vazirmatn = source('vazirmatn')
    for weight in (400, 600):
        font = TTFont(io.BytesIO(_bytes(vazirmatn)))
        write(instancer.instantiateVariableFont(font, {'wght': weight}), PERSIAN, f'vazirmatn-{weight}.woff2')
    write(source('zcoolkuaile'), chinese(), 'zcool-kuaile.woff2')


def _bytes(font):
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


if __name__ == '__main__':
    main()
