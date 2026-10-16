# 승강기 설치 현황 CSV(cp949, 건물명·건물주소·승강기고유번호 열) → 건물명별 {주소: [고유번호…]} JSON 128조각
# 키·해시 규칙은 build_bld.py / Code.gs bookKey_ 와 같음. 사용: python3 build_elv.py 설치현황.csv … my-schedule/data/elv
import csv,re,json,os,sys,collections
sys.path.insert(0,os.path.dirname(__file__))
src=sys.argv[1:-1]; out=sys.argv[-1]
def place(n):
    x=re.sub(r'\(주\)|㈜','',n); x=re.sub(r'\([^)]*$','',x)
    x=re.sub(r'\s*[A-Z0-9,\s]+동(,\s*[A-Z0-9]+동)*\s*$','',x); x=re.sub(r'\s+',' ',x).strip()
    return x or n
def key(n):
    k=place(n); k=k.replace('주식회사',''); k=re.sub(r'[\s()·\-_.,#]','',k); k=re.sub(r'아파트$','',k)
    return k
def h(k):
    v=5381
    for ch in k: v=(v*33+ord(ch))%4294967296
    return v%128
shards=collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(set)))
rows=0;n=0
for f in src:
    with open(f,encoding='cp949',errors='replace',newline='') as fh:
        r=csv.reader(fh); hdr=next(r)
        if '승강기고유번호' not in hdr: print('번호 열 없음, 건너뜀:',f); continue
        ni=hdr.index('건물명'); ai=hdr.index('건물주소'); ei=hdr.index('승강기고유번호')
        for row in r:
            rows+=1
            if len(row)<=max(ni,ai,ei): continue
            nm=row[ni].strip(); ad=re.sub(r'\s+',' ',row[ai]).strip(); no=row[ei].strip()
            if not (nm and ad and no.isdigit()): continue
            k=key(nm)
            if len(k)<2: continue
            shards[h(k)][k][ad].add(no); n+=1
os.makedirs(out,exist_ok=True)
tot=0
for i in range(128):
    d={k:{a:sorted(v) for a,v in m.items()} for k,m in shards.get(i,{}).items()}
    s=json.dumps(d,ensure_ascii=False,separators=(',',':'))
    open(f'{out}/{i:03d}.json','w',encoding='utf-8').write(s); tot+=len(s.encode())
print('rows',rows,'elevators',n,'total MB',round(tot/1e6,1))
