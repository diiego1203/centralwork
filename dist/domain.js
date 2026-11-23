export const channels=['Mercado Livre','Shopee','Amazon','TikTok Shop'];
export const available=p=>Math.max(0,p.stock-p.reserved-p.safety);
export const round=n=>Math.round((n+Number.EPSILON)*100)/100;
export function validateRule(r){for(const k of ['fee','fixed','freight','tax','margin','programFee','subsidy','fulfillment'])if(!Number.isFinite(+r[k])||+r[k]<0)throw Error('Taxas e custos devem ser números positivos ou zero.');if(+r.fee + +r.tax + +r.margin + +r.programFee>=100)throw Error('Comissão, programa, imposto e margem devem somar menos de 100%.');}
export function quote(cost,r){validateRule(r);return Math.ceil((+cost + +r.fixed+Math.max(0,r.freight-r.subsidy)+ +r.fulfillment)/(1-(+r.fee + +r.tax + +r.margin + +r.programFee)/100)*100)/100;}
export const priceFor=(p,c)=>p.channelPrices?.[c]??p.price;
export function economics(p,c,q,r){const total=round(priceFor(p,c)*q),cost=round(p.cost*q),fees=round(total*(+r.fee + +r.programFee)/100+r.fixed*q),tax=round(total*r.tax/100),freight=round((Math.max(0,r.freight-r.subsidy)+ +r.fulfillment)*q);return{total,cost,fees,tax,freight,profit:round(total-cost-fees-tax-freight)};}
export function addOrder(s, id, channel, qty, sale) {
  const product = s.products.find(p => p.id === id);
  const stock = product && (sale ? product.stock - product.reserved : available(product));
  if (!product || !channels.includes(channel) || !Number.isInteger(qty) || qty <= 0 || qty > stock) {
    throw Error('Quantidade inválida ou estoque insuficiente.');
  }
  const rule = s.rules[channel];
  validateRule(rule);
  const date = new Date().toISOString();
  let entry = {unitPrice: priceFor(product, channel)};
  if (sale) {
    const reference = String(sale.reference ?? '').trim();
    const unitPrice = Number(sale.unitPrice);
    if (!reference || reference.length > 100 || !Number.isFinite(unitPrice) || unitPrice <= 0 || round(unitPrice) !== unitPrice) {
      throw Error('Informe a referência do canal e um preço unitário válido.');
    }
    if (s.orders.some(order => order.channel === channel && order.saleReference === reference)) {
      throw Error('Já existe uma venda com essa referência neste canal.');
    }
    entry = {unitPrice, saleReference: reference};
  }
  const order = {
    id: 'CW-' + String(s.nextOrder++).padStart(5, '0'),
    product: id, name: product.name, sku: product.sku, channel, qty, status: 'Reservado', date,
    ...entry, ...economics({...product, channelPrices: {[channel]: entry.unitPrice}}, channel, qty, rule)
  };
  product.reserved += qty;
  s.orders.unshift(order);
  return order;
}

export function recordInvoice(state, orderId, input) {
  const order = state.orders.find(item => item.id === orderId);
  if (!order?.saleReference || order.status === 'Cancelado') {
    throw Error('Selecione uma venda real em aberto ou enviada.');
  }
  const key = String(input.key ?? '').trim();
  const issuer = String(input.issuer ?? '').trim();
  if (!/^[0-9]{44}$/.test(key) || key.slice(20, 22) !== '55') {
    throw Error('Informe a chave de acesso de 44 dígitos de uma NF-e (modelo 55).');
  }
  const sum = [...key.slice(0, -1)].reverse().reduce((total, digit, index) => total + Number(digit) * (2 + index % 8), 0);
  if (Number(key.at(-1)) !== (11 - sum % 11) % 11 % 10) {
    throw Error('O dígito verificador da chave da NF-e está incorreto.');
  }
  if (!issuer || issuer.length > 80) throw Error('Informe qual emissor gerou a nota.');
  if (state.orders.some(item => item.id !== orderId && item.invoice?.key === key)) {
    throw Error('Essa NF-e já está registrada em outro pedido.');
  }
  order.invoice = {key, issuer, recordedAt: new Date().toISOString()};
  return order;
}
export function transition(s,id,status){const o=s.orders.find(o=>o.id===id);if(!o||o.status!=='Reservado'||!['Enviado','Cancelado'].includes(status))throw Error('Transição indisponível.');const p=s.products.find(p=>p.id===o.product);p.reserved-=o.qty;if(status==='Enviado')p.stock-=o.qty;o.status=status;}
export function totals(s){const orders=s.orders.filter(o=>o.status!=='Cancelado');return Object.fromEntries(['total','cost','fees','tax','freight','profit'].map(k=>[k,round(orders.reduce((a,o)=>a+o[k],0))]).concat([['count',orders.length],['inventory',round(s.products.reduce((a,p)=>a+p.stock*p.cost,0))],['available',s.products.reduce((a,p)=>a+available(p),0)]]));}
export const columns=['sku','grupo','nome','titulo','subtitulo','descricao','marca','modelo','gtin','motivo_sem_gtin','categoria','cor','tamanho','custo','preco','estoque','seguranca','material','genero','cuidados','peso_kg','comprimento_cm','largura_cm','altura_cm','ncm','cest','origem','imagens_urls','medidas_json','categoria_ml','categoria_shopee','tipo_amazon','categoria_tiktok','atributos_json'];
export function parseCSV(text){text=text.replace(/^\uFEFF/,'');const delimiter=text.split(/\r?\n/)[0].includes(';')?';':',';let rows=[],row=[],v='',quoted=false;for(let i=0;i<text.length;i++){let c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){v+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(v);v='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(v);if(row.some(Boolean))rows.push(row);row=[];v='';}else v+=c;}if(quoted)throw Error('CSV contém aspas sem fechamento.');row.push(v);if(row.some(Boolean))rows.push(row);if(!rows.length)throw Error('Planilha vazia.');const headers=rows.shift().map(x=>x.trim().toLowerCase());if(!headers.includes('sku')||!headers.includes('nome'))throw Error('Cabeçalhos sku e nome são obrigatórios.');if(new Set(headers).size!==headers.length)throw Error('Cabeçalhos duplicados.');return rows.map((r,i)=>{if(r.length!==headers.length)throw Error('Quantidade de colunas incorreta na linha '+(i+2));return Object.fromEntries(headers.map((h,j)=>[h,r[j]]));});}
export function importProduct(r,old){const p={...old,id:old?.id||crypto.randomUUID(),reserved:old?.reserved||0,channelPrices:old?.channelPrices||{}};for(const [a,b] of Object.entries({sku:'sku',grupo:'group',nome:'name',titulo:'title',subtitulo:'subtitle',descricao:'description',marca:'brand',modelo:'model',gtin:'gtin',motivo_sem_gtin:'gtinReason',categoria:'category',cor:'color',tamanho:'size',material:'material',genero:'gender',cuidados:'care',ncm:'ncm',cest:'cest',origem:'origin'}))p[b]=String(r[a]??old?.[b]??'').trim();if(!p.sku||!p.name)throw Error('SKU e nome obrigatórios.');for(const [a,b]of Object.entries({custo:'cost',preco:'price',estoque:'stock',seguranca:'safety',peso_kg:'weight',comprimento_cm:'length',largura_cm:'width',altura_cm:'height'})){const val=r[a]===undefined?old?.[b]??0:r[a]===''?0:Number(String(r[a]).replace(',','.'));if(!Number.isFinite(+val)||val<0)throw Error(a+' inválido');p[b]=+val;}if(!Number.isInteger(p.stock)||!Number.isInteger(p.safety)||p.stock<p.reserved+p.safety)throw Error('Estoque deve cobrir reservas e segurança; use quantidades inteiras.');if(old?.price!==p.price)p.channelPrices={};p.images=r.imagens_urls===undefined?old?.images||[]:String(r.imagens_urls).split('|').map(x=>x.trim()).filter(Boolean);if(p.images.some(u=>!/^https:\/\//i.test(u)))throw Error('Imagens devem ter URLs HTTPS, separadas por |.');p.measures=r.medidas_json?JSON.parse(r.medidas_json):old?.measures||[];if(!Array.isArray(p.measures)||p.measures.some(m=>!m.tamanho||['altura','largura','manga'].some(k=>!Number.isFinite(+m[k])||+m[k]<=0)))throw Error('Tabela de medidas inválida.');p.attributes=r.atributos_json?JSON.parse(r.atributos_json):old?.attributes||{};if(!p.attributes||typeof p.attributes!=='object'||Array.isArray(p.attributes))throw Error('Atributos devem ser objeto JSON.');p.categories={...old?.categories};['categoria_ml','categoria_shopee','tipo_amazon','categoria_tiktok'].forEach((k,i)=>{if(r[k]!==undefined)p.categories[channels[i]]=r[k];});return p;}
export function issues(p,c){return [[!p.title,'título'],[!p.description,'descrição'],[!p.brand,'marca'],[!p.images?.length,'imagens'],[!p.weight,'peso'],[!p.categories?.[c],'categoria / tipo do canal'],[!p.gtin&&!p.gtinReason,'GTIN ou justificativa']].filter(x=>x[0]).map(x=>x[1]);}
