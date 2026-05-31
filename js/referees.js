/*--------------------------Оценки судей ----------------------------*/

function changeRefereeTime() {
    refereeTime--;
    referee_donut.setState({ value: refereeTime});
    document.getElementById("referee_timer").textContent = formatTime(refereeTime);
    if (refereeTime <= finishingTime) { 
        referee_donut.setState({ color: finishingTimerColor }); 
        document.getElementById("referee_donut_bg").style.visibility="visible";
        document.getElementById('referee_donut_bg').classList.add('pulsing');
        if (soundsEnabled) {audioTicking.play(); }
    }
}

function refereeTimer(regime)
{
    switch(regime) {
        case   "start" : 
                refereeTime=60; 
                referee_donut.setState({ value: refereeTime,  color: secondaryTimerColor});
                document.getElementById("referee_donut_bg").style.visibility="hidden";
                document.getElementById('referee_donut_bg').classList.remove('pulsing');
                document.getElementById("referee_timer").textContent = formatTime(refereeTime);
                stopAudio(audioTicking);            
                break;
        case   "start_timer" : 
                 refereeTimerID = setInterval(changeRefereeTime, 1000)
                 document.getElementById("finish_duel_timer_start_button").disabled = true;
                 break;              
        
        case   "stop_timer" : 
                clearInterval(refereeTimerID);
                document.getElementById("finish_duel_timer_start_button").disabled = false;
                refereeTime=60; 
                document.getElementById("referee_donut_bg").style.visibility="hidden";
                document.getElementById('referee_donut_bg').classList.remove('pulsing');
                referee_donut.setState({ value: refereeTime,  color: secondaryTimerColor});
                document.getElementById("referee_timer").textContent = formatTime(refereeTime);              
                stopAudio(audioTicking);
                break;                              
      }
}

function shortNameForPerson(fullName) {
    if (!fullName || typeof fullName !== "string") return "";
    var parts = fullName.trim().split(/\s+/);
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0].length > 12 ? parts[0].slice(0, 10) + "…" : parts[0];
    var last = parts[parts.length - 1];
    var initials = parts.slice(0, -1).map(function (p) { return (p.charAt(0) || "").toUpperCase() + "."; }).join(" ");
    return (initials + " " + last).trim();
}

function applyJudgesNamesFromAssignments() {
    var cd = (currentDuel != null && currentDuel !== "-1") ? (typeof currentDuel === "string" ? parseInt(currentDuel, 10) : currentDuel) : 0;
    if (isNaN(cd) || cd < 0 || !duelAssignments[cd] || !duelAssignments[cd].judges) return;
    var slots = (typeof getJudgeSlotsForDuel === "function") ? getJudgeSlotsForDuel(cd) : [];
    var vis = [];
    for (var i = 0; i < 11; i++) if (refereeList[i].visible) vis.push(i);
    for (var k = 0; k < vis.length; k++) {
        var slotKey = (k < slots.length) ? slots[k] : null;
        var pid = slotKey ? getAssignmentSlot(cd, slotKey) : null;
        var full = pid && people[pid] ? people[pid].fullName : "";
        refereeList[vis[k]].Caption = full ? full.trim() : ("Судья " + (k + 1));
        refereeList[vis[k]]._fullName = full;
    }
}

function initRefereeStructure(refQty)
{
 if (duelType === 'express')
 {
    refereeQty=5;
    refereeList = [
        {"Сaption": ""           ,"college":"job" ,"vote":0, "visible":false },
        {"Сaption": ""           ,"college":"job" ,"vote":0, "visible":false },
        {"Сaption": ""           ,"college":"job" ,"vote":0, "visible":false },
        {"Сaption": "Судья&nbsp1","college":"deal","vote":0, "visible":true  },
        {"Сaption": "Судья&nbsp2","college":"deal" ,"vote":0,"visible":true  },
        {"Сaption": "Судья&nbsp3","college":"deal" ,"vote":0,"visible":true  },
        {"Сaption": "Судья&nbsp4","college":"deal" ,"vote":0,"visible":true  },
        {"Сaption": "Судья&nbsp5","college":"deal" ,"vote":0,"visible":true  },
        {"Сaption": ""           ,"college":"own"  ,"vote":0,"visible":false },
        {"Сaption": ""           ,"college":"own"  ,"vote":0,"visible":false },
        {"Сaption": ""           ,"college":"own"  ,"vote":0,"visible":false },];
    setReferee(3);
 }
 else {
    if (refQty!=-1) {refereeQty=refQty;};
    if (currentDuel != null && currentDuel !== undefined && duelsList && duelsList[currentDuel]) {
        duelsList[currentDuel].RefereeQty = refereeQty;
    }
    switch(refereeQty) {
        case   9 : 
                refereeList = [
                    {"Сaption": "Судья&nbsp1","college":"job" ,"vote":0, "visible":true },
                    {"Сaption": "Судья&nbsp2","college":"job" ,"vote":0, "visible":true },
                    {"Сaption": "Судья&nbsp3","college":"job" ,"vote":0, "visible":true },
                    {"Сaption": "           ","college":"deal","vote":0, "visible":false},
                    {"Сaption": "Судья&nbsp4","college":"deal" ,"vote":0,"visible":true },
                    {"Сaption": "Судья&nbsp5","college":"deal" ,"vote":0,"visible":true },
                    {"Сaption": "Судья&nbsp6","college":"deal" ,"vote":0,"visible":true },
                    {"Сaption": ""           ,"college":"deal" ,"vote":0,"visible":false},
                    {"Сaption": "Судья&nbsp7","college":"own"  ,"vote":0,"visible":true },
                    {"Сaption": "Судья&nbsp8","college":"own"  ,"vote":0,"visible":true },
                    {"Сaption": "Судья&nbsp9","college":"own"  ,"vote":0,"visible":true },]                    
                setReferee(0);
                break;
        case   7 : 
                refereeList = [
                    {"Сaption": ""           ,"college":"job" ,"vote":0, "visible":false },
                    {"Сaption": "Судья&nbsp1","college":"job" ,"vote":0, "visible":true  },
                    {"Сaption": "Судья&nbsp2","college":"job" ,"vote":0, "visible":true  },
                    {"Сaption": ""           ,"college":"deal","vote":0, "visible":false },
                    {"Сaption": "Судья&nbsp3","college":"deal" ,"vote":0,"visible":true  },
                    {"Сaption": "Судья&nbsp4","college":"deal" ,"vote":0,"visible":true  },
                    {"Сaption": "Судья&nbsp5","college":"deal" ,"vote":0,"visible":true  },
                    {"Сaption": ""           ,"college":"deal" ,"vote":0,"visible":false },
                    {"Сaption": "Судья&nbsp6","college":"own"  ,"vote":0,"visible":true  },
                    {"Сaption": "Судья&nbsp7","college":"own"  ,"vote":0,"visible":true  },
                    {"Сaption": ""           ,"college":"own"  ,"vote":0,"visible":false },];
                setReferee(1);
                break; 
        case   5 : 
                refereeList = [
                    {"Сaption": ""           ,"college":"job"  ,"vote":0, "visible":false},
                    {"Сaption": ""           ,"college":"job"  ,"vote":0, "visible":false},
                    {"Сaption": "Судья&nbsp1","college":"job"  ,"vote":0, "visible":true },
                    {"Сaption": ""           ,"college":"deal" ,"vote":0, "visible":false},
                    {"Сaption": "Судья&nbsp2","college":"deal" ,"vote":0,"visible":true  },
                    {"Сaption": "Судья&nbsp3","college":"deal" ,"vote":0,"visible":true  },
                    {"Сaption": "Судья&nbsp4","college":"deal" ,"vote":0,"visible":true  },
                    {"Сaption": ""           ,"college":"deal" ,"vote":0,"visible":false },
                    {"Сaption": "Судья&nbsp5","college":"own"  ,"vote":0,"visible":true  },
                    {"Сaption": ""           ,"college":"own"  ,"vote":0,"visible":false },
                    {"Сaption": ""           ,"college":"own"  ,"vote":0,"visible":false },];
                setReferee(2);
                break; 
    }          

 }
 applyJudgesNamesFromAssignments();
 highlightReferee ();
}

function playerVoteLabel(side, college) {
    var duel = (duelsList && currentDuel != null && currentDuel !== undefined && currentDuel !== "-1") ? duelsList[currentDuel] : null;
    var name = (typeof formatPlayerSideDisplay === "function" && duel) ? formatPlayerSideDisplay(duel, side) : (document.getElementById("Player" + side + "Name").value.trim());
    var isPair = (typeof normalizeDuelTypeStr === "function" && duel)
        ? normalizeDuelTypeStr(duel.Type) === "pair"
        : duelType === "pair";
    var prefix = isPair ? ("Паре " + side) : ((college === "deal") ? ("Игрока №" + side) : ("Игроку №" + side));
    return name ? (prefix + " — " + name) : prefix;
}

function setReferee(ref)
{
    activeReferee=ref;
    highlightReferee();
    if (activeReferee===-1)
    {
        document.getElementById("plr1radio").checked=false;
        document.getElementById("plr2radio").checked=false;
        document.getElementById("plr1radio").disabled=true;
        document.getElementById("plr2radio").disabled=true;
        document.getElementById("finish_duel_next_referee_button").disabled=true;        
    }
    else
    {
        switch (refereeList[activeReferee].vote) 
        {
        case  0:
                    document.getElementById("plr1radio").checked=false;
                    document.getElementById("plr2radio").checked=false;
                    break;
        case  1:
                    document.getElementById("plr1radio").checked=true;                
                    break;
        case  2: 
                    document.getElementById("plr2radio").checked=true;                
                    break;
        }
        document.getElementById("plr1radio").disabled=false;
        document.getElementById("plr2radio").disabled=false;    
        document.getElementById("finish_duel_next_referee_button").disabled=false;        
        
        switch (refereeList[activeReferee].college) 
        {
        case  "job":
                    document.getElementById("college_hint").textContent=  "я бы нанялся на работу к";
                    document.getElementById("plr1radiolabel").textContent = playerVoteLabel(1, "job");
                    document.getElementById("plr2radiolabel").textContent = playerVoteLabel(2, "job");
                    document.getElementById("referee_hint").innerHTML = " <p> Судьи <b>Нанимающиеся на работу</b> оценивают способность к установлению и поддержанию положительных человеческих контактов, когда на первый план                     выступает выполнение обещаний, уважение человеческого достоинства делового партнера или подчиненного и другие морально-этические соображения, а также способность руководителя обеспечить материальное и моральное благополучие своих подчиненных. Их не волнует, как понравится участник зрителям. Их волнует, у кого из них им будет лучше работать:<ul class=\"font-size-sm line-height-sm\"> <li>не обманет ли их руководитель, пообещав вначале золотые горы насколько комфортную атмосферу установит в коллективе, будет ли заботиться о них, о достойном заработке, об условиях труда, об их перспективе роста,позволит ли проявлять инициативу, не развалит ли фирму, лишив их тем самым заработка</li>  <li>не будет ли идти на поводу у своих подчиненных во вред процветанию фирмы и тем самым этих подчиненных</li> <li> не даст ли водить себя за нос нечестным людям</li>  <li> не будет ли вечно колебаться и мяться, тянуть с принятием неотложных решений </li> <li> даст ли повод им гордиться или стыдиться</li> <li> не будет ли пытаться их втянуть в аморальные поступки или образ жизни</li> <li> будет ли им защитой и опорой и т. д</li> </ul></p>"  
                    break;
        case  "deal":
                    document.getElementById("college_hint").textContent=  "я бы отправил вместо себя на переговоры";
                    document.getElementById("plr1radiolabel").textContent = playerVoteLabel(1, "deal");
                    document.getElementById("plr2radiolabel").textContent = playerVoteLabel(2, "deal");
                    document.getElementById("referee_hint").innerHTML = " <p>  Судьи <b>Отправляющие на переговоры </b> cмотрят на происходящее с точки зрения человека, которому необходимо доверить провести переговоры одному из коллег. Они оценивают способность к перехвату и удержанию управления, когда на первый план выступает умение продвинуть вперед защищаемые интересы, не вступив при этом в серьезный конфликт с другой стороной переговоров. Их волнует, насколько участники сильны как переговорщики, готовы ли они к ведению переговоров в жесткой и конфликтной ситуации:<ul class=\"font-size-sm line-height-sm\"> <li>умеет ли руководитель строить адекватную картину мира, эффективно воздействовать на картину мира партнера</li><li>достаточно ли этически совершенен</li><li>умеет ли вести позиционную борьбу и располагаться на выгодной местности </li><li>умеет ли различать пустое и твердое , находить уязвимые места в позиции другого</li><li>способен ли вести деловую борьбу «здесь и сейчас» с достаточной психологической силой, скоростью, точностью</li><li>способен ли обходить ловушки, не поддаваться страстям и разглядывать победу</li><li>можно ли ему доверить ведение переговоров в жестких условиях</li><li>умеет ли держать свою цель и т. д.</li></ul></p>"     
                    break;
        case  "own": 
                    document.getElementById("college_hint").textContent=  "я бы доверил свою собственность";
                    document.getElementById("plr1radiolabel").textContent = playerVoteLabel(1, "own");
                    document.getElementById("plr2radiolabel").textContent = playerVoteLabel(2, "own");
                    document.getElementById("referee_hint").innerHTML = " <p> Судьи <b>Доверяющие собственость</b> смотрят на происходящее с точки зрения человека, которому необходимо доверить свою собственность (денежные средства, др. ресурсы) одному из участников. Они оценивают способность к сохранению и приумножению капитала и иной собственности, когда на первый план выступает умение получить в итоге, «в сухом остатке», положительный для дела результат. Их волнует, что произойдет, если они инвестируют свои средства в подразделение этого руководителя или доверят управление своей собственностью именно ему:<ul class=\"font-size-sm line-height-sm\"><li>будет ли приумножаться собственность</li><li>будет ли она приумножаться энергично или фактически лишь на уровне инфляции</li><li>не даст ли ее растащить</li><li>не пустится ли в авантюры</li><li>не украдет ли сам</li><li>не уподобится ли «собаке на сене» или Плюшкину, отчего собственность придет в упадок</li><li>не восстановит ли против себя сотрудников, клиентов или общественность до такой степени, что собственность будет просто уничтожена</li><li>не войдет ли в конфликт с законом или государственными органами и т. д.</li></ul></p>"     
                    break;
        }
        
    }
    refereeTimer("stop_timer");
}



function nextReferee()
{
 var ar=-1;
 var i=activeReferee+1;
 while (ar===-1 && i<11)
 {
    if (refereeList[i].visible && refereeList[i].vote===0){ar=i};
    i++;
 }
 i=0;
 while (ar===-1 && i<activeReferee)
 {
    if (refereeList[i].visible && refereeList[i].vote===0)  {ar=i};
    i++;
 }
 setReferee(ar);
 highlightReferee();
 saveProtocolStateToLocalStorage();
}

function refereeVote(vt)
{
    if (refereeList[activeReferee].vote === vt) {
        refereeList[activeReferee].vote = 0;
    } else {
        refereeList[activeReferee].vote = vt;
    }
    highlightReferee();
    saveProtocolStateToLocalStorage();
}

function calcAndShowScore()
{
  var score = [0, 0, 0];
  var unvotedCount = 0;
    for (let i = 0; i < 11; i++) {
       if (refereeList[i].visible) {
           if (refereeList[i].vote === 1 || refereeList[i].vote === 2) score[refereeList[i].vote]++;
           else unvotedCount++;
        }
    }
    document.getElementById("Player1Score").innerHTML = "&nbsp"+score[1]+"&nbsp";
    document.getElementById("Player2Score").innerHTML = "&nbsp"+score[2]+"&nbsp";
    var drumBtn = document.getElementById("finish_duel_drum_btn");
    if (drumBtn) {
        var equalScore = (score[1] === score[2]);
        var waitingLastJudge = equalScore && (unvotedCount === 1);
        drumBtn.classList.remove("btn-outline-secondary", "btn-warning");
        drumBtn.classList.add(waitingLastJudge ? "btn-warning" : "btn-outline-secondary");
    }
}

function highlightReferee ()
{
    for (let i=0; i<11;i++)
    {
       if (refereeList[i].visible)
        {
         var but = document.getElementById("refBut"+i);
         but.style.visibility = "visible";
         but.innerHTML = refereeList[i].Caption || refereeList[i].Сaption || "";
         but.title = refereeList[i]._fullName || refereeList[i].Caption || refereeList[i].Сaption || "";
         but.style.fontSize = (refereeList[i]._fullName ? "0.85em" : "");
        }
      else
       {
        document.getElementById("refBut"+i).style.visibility = "hidden";        
       }  

       document.getElementById("refBut"+i).classList.remove("btn-dark", 
                                                            "btn-"+PlayerVoteStyle[0], "btn-"+PlayerVoteStyle[1], "btn-"+PlayerVoteStyle[2],
                                                            "btn-outline-"+PlayerVoteStyle[0], "btn-outline-"+PlayerVoteStyle[1], "btn-outline-"+PlayerVoteStyle[2]);
       var bstyle;                                                     
       if(activeReferee===i){
        bstyle= "btn-outline-"+ PlayerVoteStyle[refereeList[i].vote]} 
        else {
            bstyle= "btn-"+ PlayerVoteStyle[refereeList[i].vote]
        } ;                                                   
       document.getElementById("refBut"+i).classList.add(bstyle);
    }
    calcAndShowScore();
}

