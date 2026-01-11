// ===== Dexie DB =====
const db = new Dexie("StampAppDB");
db.version(14).stores({
  stamps: "id,name,image,shape",
  histories: "id,stampId,date,size",
  months: "id,year,month,bgImage,bgBrightness,bgOpacity",
  settings: "key"
}).upgrade(async tx => {
    tx.table("histories").toCollection().modify(h => {
       if (!h.size) h.size = 1;
    });
  const stamps = await tx.table("stamps").toArray();

  for (const stamp of stamps) {
    if (!stamp.shape) {
      stamp.shape = "square";
    }
    if (!stamp.style) {
      stamp.style = { border: { enabled: false, color: "#ff4d6d", size: 4 } };
    }

    if (typeof stamp.image === "string") {
      const res = await fetch(stamp.image);
      const blob = await res.blob();
      stamp.image = blob;
    }
    await tx.table("stamps").put(stamp);
  }
});


let scrollPos = 0;

function openModal(modal) {
  scrollPos = window.scrollY || window.pageYOffset;
  setHelpButtonsVisible(false);
  // スクロール位置を保持したまま body を固定
  document.body.classList.add("modal-open");
  document.body.style.top = `-${scrollPos}px`;

  modal.style.display = "flex";
}

function closeModal(modal) {
  modal.style.display = "none";
  setHelpButtonsVisible(true);
  // body を解放
  document.body.classList.remove("modal-open");
  document.body.style.top = "";

  // ★ 開いた瞬間の位置に正確に戻す
  window.scrollTo(0, scrollPos);

  // iOS対策（フォーカス逃がし）
  setTimeout(() => {
    document.getElementById("focusGuard")?.focus();
  }, 0);
}

// ===== modal表示中：画面ピンチ制御 =====
document.addEventListener("gesturestart", e => {
  if (!document.body.classList.contains("modal-open")) return;

  // canvas 内は完全許可
  if (e.target.closest("#cropCanvas")) return;

  // 拡大だけ禁止
  if (e.scale > 1) {
    e.preventDefault();
  }
});

document.addEventListener("gesturechange", e => {
  if (!document.body.classList.contains("modal-open")) return;

  // canvas 内は完全許可
  if (e.target.closest("#cropCanvas")) return;

  // 拡大だけ禁止、縮小は許可
  if (e.scale > 1) {
    e.preventDefault();
  }
});



// ===== 登録スタンプ表示 =====
async function loadStamps() {
  const grid = document.getElementById("stampGrid");
  grid.innerHTML = "";
  const stamps = await db.stamps.toArray();
    stamps.forEach(s => {
      const item = document.createElement("div");
      item.className = "stampItem";

      const img = document.createElement("img");
      img.src = s.image instanceof Blob ? URL.createObjectURL(s.image) : s.image;
      img.classList.add("stamp-image");
      item.appendChild(img);

      // ===== 長押し削除用 =====
      let timer = null;
      let longPressed = false;

      const startLongPress = () => {
        longPressed = false;
        timer = setTimeout(async () => {
          longPressed = true;

          if (confirm(`「${s.name}」を削除しますか？`)) {
            await db.stamps.delete(s.id);

            const histories = await db.histories
              .filter(h => h.stampId === s.id)
              .toArray();

            for (const h of histories) {
              await db.histories.delete(h.id);
            }

            loadStamps();
            loadCalendarBoard();
          }
        }, 700); // ← 升目とほぼ同じ
      };

      const cancelLongPress = () => {
        clearTimeout(timer);
      };

      ["mousedown", "touchstart"].forEach(ev =>
        item.addEventListener(ev, startLongPress)
      );

      ["mouseup", "mouseleave", "touchend", "touchcancel"].forEach(ev =>
        item.addEventListener(ev, cancelLongPress)
      );

      // ===== 短押し（選択） =====
      item.onclick = () => {
        if (longPressed) {
          longPressed = false;
          return;
        }

        // ← ここは「スタンプ選択処理」があればそのまま
        // （現状は何もしなくてOK）
      };

      grid.appendChild(item);
    });}




// ===== スタンプ登録 =====
document.getElementById("saveStamp").onclick = async () => {
  const file = document.getElementById("stampImage").files[0];
  if (!file) {
    alert("画像を選んでください");
    return;
  }

  const nameInput = document.getElementById("stampName");
  if (!nameInput.value.trim()) nameInput.value = "name";
  const name = nameInput.value.trim();
  
  const cropModal = document.getElementById('cropModal');
  cropModal.classList.remove('bg-mode');
    
  openCropModal(file, async (croppedBlob, style) => {
    const shape =
      document.querySelector("input[name='clipShape']:checked")?.value
      || "square";

    await db.stamps.add({
      id: crypto.randomUUID(),
      name,
      image: croppedBlob,
      shape,
      style
    });

    loadStamps();
    loadCalendarMonths();
  });

  nameInput.value = "";
  document.getElementById("stampImage").value = "";

    // フォームをリセット
    nameInput.value = "";
    document.getElementById("stampImage").value = "";
};

const helpButtons = document.querySelectorAll(".floating-btn");

// ボタンクリック → 対応するモーダルを開く
helpButtons.forEach(btn => {
  btn.onclick = () => {
    const modalId = btn.dataset.target;
    const modal = document.getElementById(modalId);
    if (modal) {
      openModal(modal);
    }
  };
});

function setHelpButtonsVisible(visible) {
  document.querySelectorAll(".floating-btn").forEach(btn => {
    btn.style.opacity = visible ? "1" : "0";
    btn.style.pointerEvents = visible ? "auto" : "none";
  });
}

// スクロールでまとめて消す
window.addEventListener("scroll", () => {
  const hide = window.scrollY > 80;

  helpButtons.forEach(btn => {
    btn.style.opacity = hide ? "0" : "1";
    btn.style.pointerEvents = hide ? "none" : "auto";
  });
});

document.querySelectorAll(".modal-close").forEach(btn => {
  btn.onclick = () => {
    const modal = btn.closest(".modal");
      if (modal) {
          closeModal(modal)
      };
  };
});

// モーダル背景クリックで閉じる（全モーダル共通）
document.querySelectorAll(".modal").forEach(modal => {
  modal.addEventListener("click", e => {
    if (e.target === modal) {
        closeModal(modal);
    }
  });
});

// ===== トリミングモーダル =====


function openCropModal(
  file,
  callback,
  {
    mode = "stamp",      // "stamp" | "background"
    description = "ピンチとドラッグでトリミング,点線はガイドライン"
  } = {}
) {
    
    const cropModal = document.getElementById("cropModal");

    // ★ 今回追加するのはこの1行（＋取得行）
    cropModal.classList.toggle("bg-mode", mode === "background");
    
    const borderEnable = document.getElementById("borderEnabled");
    const borderColor  = document.getElementById("borderColor");
    const borderSize   = document.getElementById("borderWidth");
    const borderOptions = document.getElementById("borderOptions");
    // null 安全化
    if (borderEnable) borderEnable.checked = false;
    if (borderColor)  borderColor.value = "#ff4d6d";
    if (borderSize)   borderSize.value = 4;
    // 初期状態オブジェクト
    const borderState = {
      enabled: borderEnable?.checked ?? false,
      color: borderColor?.value ?? "#ff4d6d",
      size: parseInt(borderSize?.value ?? "4", 10)
    };

    // イベント設定（null 安全）
    if (borderEnable) borderEnable.onchange = () => { borderState.enabled = borderEnable.checked; requestDraw(); };
    if (borderColor)  borderColor.oninput = () => { borderState.color = borderColor.value; requestDraw(); };
    if (borderSize)   borderSize.oninput = () => { borderState.size = parseInt(borderSize.value, 10); requestDraw(); };


    
  const modal = document.getElementById("cropModal");
  const canvas = document.getElementById("cropCanvas");
  const ctx = canvas.getContext("2d");
  const memoArea = document.getElementById("stampMemo");
  memoArea.value = description;

    const shapePicker = document.querySelector(".shape-picker");
      if (shapePicker) {
        shapePicker.style.display = (mode === "background") ? "none" : "";
      }

    
  const img = new Image();

  img.onload = () => {
      console.log("画像ロード完了", img.width, img.height); // <- ここ追加
      let needsRedraw = false;
      
      const borderState = {
        enabled: borderEnable.checked,
        color: borderColor.value,
        size: parseInt(borderSize.value, 10)
      };
      
      borderEnable.onchange = null;
      borderColor.oninput = null;
      borderSize.oninput = null;

      borderEnable.onchange = () => {
        borderState.enabled = borderEnable.checked;
        requestDraw();
      };

      borderColor.oninput = () => {
        borderState.color = borderColor.value;
        requestDraw();
      };

      borderSize.oninput = () => {
        borderState.size = parseInt(borderSize.value, 10);
        requestDraw();
      };
      
      function requestDraw() {
        if (!needsRedraw) {
          needsRedraw = true;
          requestAnimationFrame(() => {
            needsRedraw = false;
            draw();
          });
        }
      }

      const maxW = Math.min(window.innerWidth * 0.9, 900);
      const maxH = Math.min(window.innerHeight * 0.7, 600);

      const canvasWidth  = mode === "background" ? maxW : 300;
      const canvasHeight = mode === "background" ? maxH : 300;

      canvas.width  = canvasWidth;
      canvas.height = canvasHeight;


    let posX = 0, posY = 0, scale = 1;
    let startX = 0, startY = 0;
    let isDragging = false, lastDist = 0;

      // ===== 初期フィット =====
      const scaleX = canvas.width / img.width;
      const scaleY = canvas.height / img.height;
      scale = Math.max(scaleX, scaleY); // 背景は「はみ出してOK」

      posX = (canvas.width  - img.width  * scale) / 2;
      posY = (canvas.height - img.height * scale) / 2;

    function getSelectedShape() {
      return document.querySelector("input[name='clipShape']:checked")?.value || "square";
    }

      const draw = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 画像
        ctx.drawImage(
          img,
          posX, posY,
          img.width * scale,
          img.height * scale
        );

        if (mode === "stamp") {

          // ===== 縁 =====
          if (borderState.enabled && borderState.size > 0) {
            ctx.save();
            ctx.strokeStyle = borderState.color;
            ctx.lineWidth = borderState.size;
            drawGuidePath(ctx, getSelectedShape(), canvas.width);
            ctx.stroke();
            ctx.restore();
          }

          // ===== ガイド（常に最後）=====
          ctx.save();
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = "rgba(0,0,0,0.6)";
          ctx.lineWidth = 2;
          drawGuidePath(ctx, getSelectedShape(), canvas.width);
          ctx.stroke();
          ctx.restore();
        }
      };



    draw();

    const getPos = e => e.touches ? e.touches[0] : e;

      const startDrag = e => {
        if (e.touches && e.touches.length === 2) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          lastDist = Math.hypot(dx, dy);
          return;
        }

        isDragging = true;
        const p = getPos(e);
        startX = p.clientX - posX;
        startY = p.clientY - posY;
      };


      const moveDrag = e => {
        if (e.touches && e.touches.length === 2) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.hypot(dx, dy);
          if (lastDist) scale *= dist / lastDist;
          lastDist = dist;
        } else if (isDragging) {
          const p = getPos(e);
          posX = p.clientX - startX;
          posY = p.clientY - startY;
        }
        requestDraw();   // ★ draw() ではなく
        e.preventDefault();
      };


    const endDrag = () => {
      isDragging = false;
      lastDist = 0;
    };

    ["mousedown", "touchstart"].forEach(ev => canvas.addEventListener(ev, startDrag));
    ["mousemove", "touchmove"].forEach(ev => canvas.addEventListener(ev, moveDrag, { passive: false }));
    ["mouseup", "mouseleave", "touchend", "touchcancel"].forEach(ev => canvas.addEventListener(ev, endDrag));

    // --- 保存 ---
      document.getElementById("cropSaveBtn").onclick = () => {
        const outCanvas = document.createElement("canvas");
        outCanvas.width  = canvas.width;
        outCanvas.height = canvas.height;

        const outCtx = outCanvas.getContext("2d");

        if (mode === "stamp") {
          outCtx.save();

          // ===== クリッピング =====
          applyClip(outCtx, getSelectedShape(), outCanvas.width);

          // ===== 画像描画 =====
          outCtx.drawImage(canvas, 0, 0);

          // ===== 縁描画 =====
          if (borderState.enabled && borderState.size > 0) {
            outCtx.strokeStyle = borderState.color;
            outCtx.lineWidth   = borderState.size;
            outCtx.stroke();
          }

          outCtx.restore();

          // ===== Blob 化して呼び出し元へ返す =====
          outCanvas.toBlob(
            blob => {
                closeModal(modal);

              callback(blob, {
                border: {
                  enabled: borderState.enabled,
                  color: borderState.color,
                  size:  borderState.size
                }
              });
            },
            "image/png"
          );

        } else {
          // ===== background モード =====
          outCtx.drawImage(canvas, 0, 0);

          outCanvas.toBlob(
            blob => {
                closeModal(modal);
              callback(blob);
            },
            "image/jpeg",
            0.9
          );
        }
      };
  };

  img.src = URL.createObjectURL(file);
    openModal(modal);
}




function drawGuidePath(ctx, shape, size) {
  ctx.beginPath();

  switch (shape) {
    case "circle":
      ctx.arc(size/2, size/2, size/2, 0, Math.PI * 2);
      break;

    case "oval":
          ctx.ellipse(
            size / 2, size / 2,
            size * 0.4, size * 0.48,  // ← 縦を長く
            0, 0, Math.PI * 2
          );
      break;

    case "heart":
      drawHeartPath(ctx, size);
      break;
    
    case "coffin": {
        const w = size;
        const h = size;

        // ===== 上側
        const topY   = h * 0.10;   // 上の平ら部分のY
        const topW   = w * 0.30;   // 上の短辺の幅

        // ===== 下側
        const bottomY = h * 0.92;  // 下の平ら部分のY
        const bottomW = w * 0.25;  // 下の短辺の幅

        // ===== 中央最大幅
        const midW = w * 0.60;

        ctx.moveTo(w / 2 - topW / 2, topY);      // ① 上左
        ctx.lineTo(w / 2 + topW / 2, topY);      // ② 上右

        ctx.lineTo(w / 2 + midW / 2, h * 0.35);     // ③ 右中央

        ctx.lineTo(w / 2 + bottomW / 2, bottomY);// ④ 下右
        ctx.lineTo(w / 2 - bottomW / 2, bottomY);// ⑤ 下左

        ctx.lineTo(w / 2 - midW / 2, h * 0.35);     // ⑥ 左中央

        ctx.closePath();
        break;
      }




    default:
      ctx.rect(0, 0, size, size);
  }

  ctx.closePath();
}



function applyClip(ctx, shape, size) {
  drawGuidePath(ctx, shape, size);
  ctx.clip();
}


function drawHeartPath(ctx, size) {
  const s = size;
  const scale = 1.5; // ← ここで大きさ調整（1.05〜1.2）

  ctx.save();

  // 中央基準でスケール
  ctx.translate(s / 2, s / 2);
  ctx.scale(scale, scale);
  ctx.translate(-s / 2, -s / 1.6);

  // ---- ハートの基本形（内接） ----
  ctx.moveTo(s / 2, s * 0.92);

  ctx.bezierCurveTo(
    s * 0.95, s * 0.7,
    s * 0.85, s * 0.25,
    s / 2, s * 0.4
  );

  ctx.bezierCurveTo(
    s * 0.15, s * 0.25,
    s * 0.05, s * 0.7,
    s / 2, s * 0.92
  );

  ctx.restore();
}



(function(){
  const modal = document.getElementById("cropModal");
  let lastTap = 0;

  modal.addEventListener("touchend", (e) => {
    // 背景だけを対象にする
    if (e.target !== modal) return;

    const now = Date.now();
    if (now - lastTap < 300) { // 300ms以内ならダブルタップ
      closeModal(modal);
    }
    lastTap = now;
  });

  // PC用（ダブルクリック）
  modal.addEventListener("dblclick", (e) => {
    if (e.target === modal) {
      closeModal(modal);
    }
  });
})();

// ===== 升目クリックでスタンプ選択 =====
let currentCellId=null;
async function showStampPicker(cellId){
  currentCellId = cellId;
  const picker = document.getElementById("stampPicker");
  const grid = document.getElementById("stampPickerGrid");
  grid.innerHTML = "";

  const stamps = await db.stamps.toArray();
  stamps.forEach(s=>{
    const img = document.createElement("img");
      img.src = s.image instanceof Blob ? URL.createObjectURL(s.image) : s.image;
      img.classList.add("stamp-image");
      
    img.onclick = async (e)=>{
      e.stopPropagation(); // ★ 重要：背景クリックを止める
    
      const sizeSlider = document.getElementById("stampSizeSlider");
      const size = sizeSlider ? parseFloat(sizeSlider.value) : 1;

        
      await db.histories.put({
        id: currentCellId,
        stampId: s.id,
        date: new Date(),
        size: size
      });

      closeModal(picker);  // ★ ここだけ

      const [yStr,mStr] = currentCellId.split('-').slice(1,3);
      await loadCalendarBoardForMonth(parseInt(yStr),parseInt(mStr));
    };

    grid.appendChild(img);
  });

    // 追加: サイズスライダーを表示
    const sliderContainer = document.getElementById("stampSizeContainer");
    let slider = document.getElementById("stampSizeSlider");
    if (!slider) {
      slider = document.createElement("input");
      slider.type = "range";
      slider.min = 0.5;
      slider.max = 2;
      slider.step = 0.05;
      slider.value = 1;
      slider.id = "stampSizeSlider";
      slider.style.width = "100%";
      sliderContainer.appendChild(slider);
    }

  openModal(picker);
}

document.getElementById("stampPicker").onclick = (e)=>{
  if(e.target.id === "stampPicker"){
    closeModal(e.target);
  }
};

// ===== 年月セレクト初期化 =====
const yearSelect=document.getElementById("yearSelect");
for(let y=2026;y<=2030;y++){ const opt=document.createElement("option"); opt.value=y; opt.textContent=y; yearSelect.appendChild(opt);}
const monthSelect=document.getElementById("monthSelect");
for(let m=1;m<=12;m++){ const opt=document.createElement("option"); opt.value=m; opt.textContent=m; monthSelect.appendChild(opt);}

// ===== 月追加 =====
document.getElementById("addSelectedMonth").onclick=async ()=>{
  const year=parseInt(yearSelect.value);
  const month=parseInt(monthSelect.value);
  await db.months.put({id:`month-${year}-${month}`,year,month,bgBrightness:1,bgOpacity:1});
  loadCalendarMonths();
}

// ===== 月削除 =====
document.getElementById("deleteMonth").onclick=async ()=>{
  const year=parseInt(yearSelect.value);
  const month=parseInt(monthSelect.value);
  if(!confirm(`${year}年${month}月を削除しますか？`)) return;
  const id=`month-${year}-${month}`;
  await db.months.delete(id);
  const prefix=`cell-${year}-${String(month).padStart(2,'0')}-`;
  const histories=await db.histories.filter(h=>h.id.startsWith(prefix)).toArray();
  for(const h of histories) await db.histories.delete(h.id);
  loadCalendarMonths();
}

// ===== 背景更新 =====
async function updateMonthBg(year, month) {
  const monthDiv = document.querySelector(
    `.month-container[data-year='${year}'][data-month='${month}']`
  );
  if (!monthDiv) return;

  const bgLayer = monthDiv.querySelector('.bg-layer');
  if (!bgLayer) return;

  const monthData = await db.months.get(`month-${year}-${month}`);
  if (!monthData) return;

  bgLayer.style.backgroundImage = monthData.bgImage
    ? `url(${monthData.bgImage})`
    : "";

  bgLayer.style.filter = `brightness(${monthData.bgBrightness ?? 1})`;
  bgLayer.style.opacity = monthData.bgOpacity ?? 1;
}


// ===== 背景アップロード =====
document.getElementById("bgUpload").onchange = e => {
  const file = e.target.files[0];
  if (!file) return;

  openBgCropModal(file);
};

function openBgCropModal(file) {
  const year = parseInt(yearSelect.value);
  const month = parseInt(monthSelect.value);
  const cropModal = document.getElementById('cropModal');
  cropModal.classList.add('bg-mode');
    
    openCropModal(
      file,
      async (blob) => {
        const reader = new FileReader();
        reader.onload = async () => {
          await db.months.update(`month-${year}-${month}`, {
            bgImage: reader.result,   // DataURL
            bgBrightness: 1,
            bgOpacity: 1
          });
          updateMonthBg(year, month);
        };
        reader.readAsDataURL(blob);
      },
      {
        mode: "background",
        description: "背景をピンチ・ドラッグで調整"
      }
    );
}



document.getElementById("bgBrightness").oninput = async e => {
  const val = parseFloat(e.target.value);
  const year = parseInt(yearSelect.value);
  const month = parseInt(monthSelect.value);
  await db.months.update(`month-${year}-${month}`, { bgBrightness: val });
  updateMonthBg(year, month);
}

document.getElementById("bgOpacity").oninput = async e => {
  const val = parseFloat(e.target.value);
  const year = parseInt(yearSelect.value);
  const month = parseInt(monthSelect.value);
  await db.months.update(`month-${year}-${month}`, { bgOpacity: val });
  updateMonthBg(year, month);
}

// ===== カレンダー描画 =====
async function loadCalendarMonths(){
  const container=document.getElementById("calendarBoard");
  container.innerHTML="";
  const months=await db.months.orderBy("id").toArray();
  for(const m of months) await renderMonth(m.year,m.month);
}

// ===== 月描画 =====
async function renderMonth(year, month){
  const container=document.getElementById("calendarBoard");
  const monthDiv=document.createElement("div");
  monthDiv.className="month-container";
  monthDiv.dataset.year=year;
  monthDiv.dataset.month=month;

  // 背景レイヤー
  const bgLayer = document.createElement("div");
  bgLayer.className="bg-layer";
  monthDiv.appendChild(bgLayer);

  const monthData = await db.months.get(`month-${year}-${month}`);
    if (monthData?.bgImage)
      bgLayer.style.backgroundImage = `url(${monthData.bgImage})`;
  bgLayer.style.filter = `brightness(${monthData?.bgBrightness ?? 1})`;
  bgLayer.style.opacity = monthData?.bgOpacity ?? 1;

  // コンテンツレイヤー
  const contentLayer=document.createElement("div");
  contentLayer.className="content-layer";
  monthDiv.appendChild(contentLayer);

  const title=document.createElement("h3");
  title.textContent=`${year}/${month}`;
  contentLayer.appendChild(title);

  const weekDays=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const weekRow=document.createElement("div");
  weekRow.className="week-row";
  weekDays.forEach(d=>{
    const w=document.createElement("div"); w.className="weekday"; w.textContent=d; weekRow.appendChild(w);
  });
  contentLayer.appendChild(weekRow);

  const daysInMonth=new Date(year,month,0).getDate();
  const firstDay=new Date(year,month-1,1).getDay();
  const grid=document.createElement("div"); grid.className="calendar-grid";

  for(let i=0;i<firstDay;i++){ const empty=document.createElement("div"); empty.className="stamp empty"; grid.appendChild(empty); }

  for(let day=1;day<=daysInMonth;day++){
    const cell=document.createElement("div"); cell.className="stamp";
    const cellId=`cell-${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    cell.dataset.cellId=cellId;

    const label=document.createElement("div"); label.className="date-label"; label.textContent=day;
    cell.appendChild(label);

    const imgContainer=document.createElement("div"); imgContainer.className="imgContainer";
    imgContainer.style.width="100%"; imgContainer.style.height="100%";
    imgContainer.style.display="flex"; imgContainer.style.alignItems="center"; imgContainer.style.justifyContent="center";
    cell.appendChild(imgContainer);

    let timer,longPress=false;
    const startLong=()=>{ timer=setTimeout(async()=>{ longPress=true; if(confirm("このスタンプを削除しますか？")){ await db.histories.delete(cellId); loadCalendarBoardForMonth(year,month); } },800);};
    const cancelLong=()=>clearTimeout(timer);
    ["mousedown","touchstart"].forEach(ev=>cell.addEventListener(ev,startLong));
    ["mouseup","mouseleave","touchend"].forEach(ev=>cell.addEventListener(ev,cancelLong));

    cell.onclick=()=>{ if(longPress){longPress=false; return;}
        showStampPicker(cellId); };
    grid.appendChild(cell);
  }
  contentLayer.appendChild(grid);

  const monthStats=document.createElement("div"); monthStats.className="month-stats"; contentLayer.appendChild(monthStats);
  container.appendChild(monthDiv);
    
  const noteInput = document.createElement("input");
    noteInput.type = "text";
    noteInput.placeholder = "一言？";
    noteInput.className = "month-note";
    noteInput.value = monthData.note || "";
    noteInput.onchange = async () => {
    await db.months.update(`month-${year}-${month}`, { note: noteInput.value });
      };
    monthDiv.appendChild(noteInput);

  await loadCalendarBoardForMonth(year,month);
}

// ===== 月単位でスタンプ反映 =====
async function loadCalendarBoardForMonth(year,month){
  const cells=document.querySelectorAll(`#calendarBoard .month-container[data-year='${year}'][data-month='${month}'] .stamp`);
  const prefix=`cell-${year}-${String(month).padStart(2,'0')}-`;
  const histories=await db.histories.filter(h=>h.id.startsWith(prefix)).toArray();

  for(const cell of cells){
    const cellId=cell.dataset.cellId;
    const container = cell.querySelector(".imgContainer");
    if(container) container.innerHTML = "";

    const history=histories.find(h=>h.id===cellId);
    if(history){
      const stamp=await db.stamps.get(history.stampId);
      if(stamp){
          const wrapper = document.createElement("div");
          wrapper.className = "stampItem";
          wrapper.classList.add(`shape-${stamp.shape}`);

          if (stamp.style?.border?.enabled) {
            wrapper.style.setProperty("--border-enabled", 1);
            wrapper.style.setProperty("--border-color", stamp.style.border.color);
            wrapper.style.setProperty("--border-size", stamp.style.border.size + "px");
          }
          
          const img = document.createElement("img");
          img.src = URL.createObjectURL(stamp.image);
          img.classList.add("stamp-image");
          img.style.transform = `scale(${history.size ?? 1})`;
          
          wrapper.appendChild(img);
          container.appendChild(wrapper);
      }
    }
  }

  const monthStats=document.querySelector(`#calendarBoard .month-container[data-year='${year}'][data-month='${month}'] .month-stats`);
  if(monthStats){
    monthStats.innerHTML="";
    const stamps=await db.stamps.toArray();
    stamps.forEach(s=>{
      const count=histories.filter(h=>h.stampId===s.id).length;
      if(count===0) return;
      const div=document.createElement("div");
      const img=document.createElement("img"); img.src=URL.createObjectURL(s.image); div.appendChild(img);
          img.classList.add("stamp-image");
      const label=document.createElement("span"); label.textContent=count; div.appendChild(label);
      monthStats.appendChild(div);
    });
  }
}

// ===== 全体更新 =====
async function loadCalendarBoard(){
  const months=await db.months.toArray();
  for(const m of months) await loadCalendarBoardForMonth(m.year,m.month);
}

// ===== フォント設定 =====


const dateFontSelect = document.getElementById("dateFontSelect");
const dateColorPicker = document.getElementById("dateColorPicker");
const monthColorPicker   = document.getElementById("monthColorPicker");
const weekdayColorPicker = document.getElementById("weekdayColorPicker");


const dateFontOptions = [
    { label: "AtkinHyp-Mono", value: "'Atkinson Hyperlegible Mono', normal" },
    { label: "Gothic", value: "'Zen Kaku Gothic New', normal" },
    { label: "Ballet", value: "'Ballet', cursive" },
    { label: "Playfair Display", value: "'Playfair Display', serif" },
    { label: "Dancing Script", value: "'Dancing Script', cursive" },
    { label: "Pacifico", value: "'Pacifico', cursive" },
    { label: "Cormorant Garamond", value: "'Cormorant Garamond', serif" }
  ];


// ▼ ここで option を生成
dateFontOptions.forEach(f => {
  const opt = document.createElement("option");
  opt.value = f.value;
  opt.textContent = f.label;
  dateFontSelect.appendChild(opt);
});


async function applyDateFont(font) {
  document.documentElement.style
    .setProperty("--calendar-date-font", font);
}




dateFontSelect.onchange = async () => {
  const font = dateFontSelect.value;
  await db.settings.put({ key: "dateFont", value: font });
  applyDateFont(font);
};

dateColorPicker.onchange = async () => {
  const color = dateColorPicker.value;
  await db.settings.put({ key: "dateColor", value: color });
  applyDateColor(color);
};

monthColorPicker.onchange = async () => {
  const color = monthColorPicker.value;
  await db.settings.put({ key: "monthColor", value: color });
  applyMonthColor(color);
};

weekdayColorPicker.onchange = async () => {
  const color = weekdayColorPicker.value;
  await db.settings.put({ key: "weekdayColor", value: color });
  applyWeekdayColor(color);
};

(async () => {
  const dateColor = await db.settings.get("dateColor");
  if (dateColor) {
    dateColorPicker.value = dateColor.value;
    applyDateColor(dateColor.value);
  } else {
    applyDateColor("#333333");
  }

  const monthColor = await db.settings.get("monthColor");
  if (monthColor) {
    monthColorPicker.value = monthColor.value;
    applyMonthColor(monthColor.value);
  } else {
    applyMonthColor("#333333");
  }

  const weekdayColor = await db.settings.get("weekdayColor");
  if (weekdayColor) {
    weekdayColorPicker.value = weekdayColor.value;
    applyWeekdayColor(weekdayColor.value);
  } else {
    applyWeekdayColor("#333333");
  }
})();



async function applyDateColor(color) {
  document.documentElement.style
    .setProperty("--calendar-date-color", color);
}
async function applyMonthColor(color) {
  document.documentElement.style
    .setProperty("--calendar-month-color", color);
}

async function applyWeekdayColor(color) {
  document.documentElement.style
    .setProperty("--calendar-weekday-color", color);
}

const toggleBtn = document.getElementById("toggleMonthSettings");
const body = document.getElementById("monthSettingsBody");

let isOpen = false;

// 初期状態：閉じる
body.classList.add("closed");
body.style.height = "0px";
toggleBtn.textContent = "開く";

toggleBtn.onclick = () => {
  isOpen = !isOpen;

  if (isOpen) {
    body.classList.remove("closed");

    // ★ iOS Safari 対策：実高さを入れる
    const h = body.scrollHeight;
    body.style.height = h + "px";

    toggleBtn.textContent = "閉じる";
  } else {
    // ★ 高さを0に戻す
    body.style.height = body.scrollHeight + "px"; // 一瞬入れて
    requestAnimationFrame(() => {
      body.style.height = "0px";
      body.classList.add("closed");
    });

    toggleBtn.textContent = "開く";
  }
};

// ===== 初期化 =====
loadStamps();
loadCalendarMonths();
