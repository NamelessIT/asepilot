# Huong Dan Aseprite Cho AsePilot

Tai lieu nay tap trung vao workflow thuc te khi mo file `.aseprite` do AsePilot tao ra, va cac ky nang Aseprite can nam de sua sprite pixel art.

Nguon tham khao chinh:
- Aseprite Basics: https://www.aseprite.org/docs/basics/
- Aseprite Layers: https://www.aseprite.org/docs/layers/
- Aseprite Timeline: https://www.aseprite.org/docs/timeline/
- Aseprite Exporting: https://www.aseprite.org/docs/exporting
- Aseprite Sprite Sheets: https://www.aseprite.org/docs/sprite-sheet/
- Aseprite Tilemap: https://www.aseprite.org/docs/tilemap/

## 1. Hieu File AsePilot Tao Ra

AsePilot khong bien anh thanh mot nhan vat tach san theo mat, ao, toc, nen. Ban MVP hien tai chuyen reference image thanh mot pixel-art project co layer co ban.

Layer mac dinh:

- `Base`: pixel da generate tu anh goc.
- `Outline`: vien ngoai do AsePilot tao them neu preset can outline.
- `Edits`: layer trong nam tren cung de ban ve/chinh ngay ma khong bi anh ben duoi che.

Neu ban ve ma khong thay doi gi:

1. Bat Timeline bang phim `Tab`.
2. Kiem tra layer dang chon.
3. Chon `Edits` neu muon ve de len tren.
4. Chon `Base` neu muon sua truc tiep pixel da generate.
5. Neu layer bi khoa, mo icon khoa trong Timeline.
6. Neu dang co selection nho dau do, bam `Ctrl+D` de bo selection.
7. Kiem tra opacity cua layer/cel co phai 0 khong.

## 2. Kien Thuc Nen Nam

Trong Aseprite, sprite gom:

- Canvas: kich thuoc pixel cua file, vi du `128x128`.
- Frame: cot ngang trong Timeline, dung cho animation.
- Layer: hang doc trong Timeline, dung de tach thanh phan hinh.
- Cel: giao diem giua frame va layer; day la noi pixel that su nam.

Layer ben duoi duoc ve truoc. Layer phia tren se de len layer ben duoi.

File `.aseprite` dung de luu layer, frame, cel, tag, palette. File `.png` chi la anh xuat ra, khong giu duoc layer/frame day du.

## 3. Dieu Khien Co Ban

- `Tab`: hien/an Timeline.
- `B`: Pencil tool.
- `E`: Eraser.
- `I` hoac `Alt + click`: lay mau.
- `G`: Paint bucket.
- `M`: Rectangular selection.
- `V`: Move tool.
- `Ctrl+Z`: Undo.
- `Ctrl+Y` hoac `Ctrl+Shift+Z`: Redo.
- `Ctrl+D`: bo selection.
- `Ctrl+S`: save `.aseprite`.
- `Ctrl+Alt+Shift+S`: export.
- `1`: zoom 100%.
- Mouse wheel: zoom.
- Middle mouse / space drag: pan tuy setting.

Khi ve pixel art, nen bat `Pixel-perfect` tren thanh tool cua Pencil de tranh net bi lem doi pixel.

## 4. Workflow Sua File Tu AsePilot

1. Mo file `.aseprite`, khong mo file `.png`.
2. Bam `Tab` de hien Timeline.
3. Chon layer `Edits` de ve de len tren, hoac `Base` de sua truc tiep anh generate.
4. Dung Pencil size `1px`.
5. Lay mau bang `Alt + click`.
6. Sua silhouette truoc: dau, than, chan, vu khi, do doc duoc o zoom nho.
7. Sua cluster pixel: xoa pixel le, noi cum mau bi vo.
8. Giam chi tiet khong doc duoc o kich thuoc nho.
9. Them highlight/shadow bang 2-4 mau chinh.
10. Save `.aseprite`, roi export `.png` khi can dung trong game.

## 5. Layer Workflow Nen Dung

Voi character:

- `Shadow`: bong duoi chan.
- `Base`: mau phang cua body/outfit.
- `Shade`: bong toi.
- `Light`: diem sang.
- `Outline`: vien ngoai.
- `FX`: hieu ung rieng.
- `Edits`: test paint-over nhanh.

Voi background/tile:

- `Ground`
- `Props`
- `Decor`
- `Collision Guide`
- `Lighting`
- `Edits`

Dung layer de tach phan nao hay sua nhieu. Dung merge chi khi da chac.

## 6. Palette Va Mau

Nen gioi han palette:

- Icon/item nho: 8-16 mau.
- Character 32x32/64x64: 12-24 mau.
- Portrait/background: 24-48 mau.

Nguyen tac:

- Moi material can 3-5 sac do: dark, mid, light, highlight.
- Mau shadow khong chi la den; nen lech hue mot chut.
- Outline nen toi hon mau base, nhung khong nhat thiet la den tuyet doi.
- Kiem tra sprite o zoom 100%/200%, khong chi zoom 800%.

## 7. Chon, Cat, Tach Layer

- Dung Selection tool de khoanh vung.
- `Ctrl+C`, `Ctrl+V`: copy/paste thanh cel/layer moi.
- `Ctrl+J`: tao layer moi tu selection.
- `Ctrl+Shift+J`: cat selection sang layer moi.
- Dung `Layer > Properties` de doi ten, opacity, user data.

Khi khong ve duoc, thu `Ctrl+D` truoc. Nhieu luc ban dang co selection nho nen ve ngoai selection khong co tac dung.

## 8. Animation Co Ban

1. Tao frame moi bang `Alt+N`.
2. Bat Onion Skin bang `F3`.
3. Ve key pose truoc.
4. Them in-between sau.
5. Doi frame duration bang click chuot phai vao frame.
6. Dung tag de tach animation: idle, walk, attack, hurt.

Workflow character co ban:

- Idle: 4-6 frame.
- Walk: 6-8 frame.
- Attack: 4-8 frame.
- Hurt: 2-4 frame.

## 9. Export Cho Game

- Luu source bang `.aseprite`.
- Export preview bang `.png`.
- Animation thi dung `File > Export Sprite Sheet`.
- Bat trim/crop chi khi engine cua ban xu ly duoc offset.
- Neu lam tileset, giu cell size on dinh: 16x16, 32x32, 48x48, 64x64.
- Dat pivot/origin thong nhat trong engine, khong sua tay moi frame.

## 10. Loi Hay Gap

Khong ve thay doi:

- Dang chon sai layer.
- Layer phia tren dang che layer ban ve.
- Layer/cel bi khoa.
- Dang co selection.
- Mau foreground/background trung voi mau hien co.
- Dang ve tren frame khac.
- Dang edit tilemap mode khac.

Sprite bi mo:

- Da resize/export bang linear filtering.
- Trong game engine dang bat texture filtering.
- Can dung nearest-neighbor / point filtering.

File mo nhu anh phang:

- Ban dang mo `.png`, khong phai `.aseprite`.
- Hoac file `.aseprite` chi co 1 layer generate. AsePilot MVP khong semantic-segment nhan vat thanh tung bo phan.

## 11. Ky Thuat Pixel Art Nen Tap

- Silhouette first: nhin o zoom nho van doc duoc hinh.
- Cluster cleanup: tranh pixel le neu khong co muc dich.
- Avoid pillow shading: khong to sang toi quanh vien mot cach deu deu.
- Hue shifting: shadow lech hue ve lanh, highlight lech ve am tuy style.
- Anti-alias co kiem soat: dung 1-2 mau trung gian o canh cheo, khong lam mo het vien.
- Dithering tiet che: dung cho gradient vat lieu lon, khong lam nhieu tren sprite nho.
- Reuse palette: giu style dong nhat giua nhieu asset.

## 12. Checklist Khi Sua Output AsePilot

- Mo `.aseprite`.
- Bat Timeline.
- Chon `Edits` hoac `Base`.
- Tat grid neu grid lam roi mat: `View > Grid`.
- Kiem tra o zoom 100%, 200%, 400%.
- Sua silhouette.
- Sua mau/chuyen sac.
- Sua outline.
- Save `.aseprite`.
- Export `.png` hoac sprite sheet.

