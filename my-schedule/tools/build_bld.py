# 승강기 설치 현황 CSV(cp949, 건물명·건물주소 열) → 건물명별 주소 JSON 128조각 (Code.gs bookKey_·해시와 같은 규칙)
import csv,re,json,os,sys,collections
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
pairs=set();rows=0
for f in src:
    with open(f,encoding='cp949',errors='replace',newline='') as fh:
        r=csv.reader(fh); hdr=next(r)
        ni=hdr.index('건물명'); ai=hdr.index('건물주소')
        for row in r:
            rows+=1
            if len(row)<=max(ni,ai): continue
            nm=row[ni].strip(); ad=re.sub(r'\s+',' ',row[ai]).strip()
            if nm and ad: pairs.add((nm,ad))
shards=collections.defaultdict(lambda: collections.defaultdict(list))
for nm,ad in pairs:
    k=key(nm)
    if len(k)<2: continue
    e=shards[h(k)][k]
    if ad not in e: e.append(ad)
os.makedirs(out,exist_ok=True)
tot=0
for i in range(128):
    d=shards.get(i,{})
    s=json.dumps(d,ensure_ascii=False,separators=(',',':'))
    open(f'{out}/{i:03d}.json','w',encoding='utf-8').write(s); tot+=len(s.encode())
print('rows',rows,'unique pairs',len(pairs),'keys',sum(len(v) for v in shards.values()),'total MB',round(tot/1e6,1))
