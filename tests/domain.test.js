import test from 'node:test';import assert from 'node:assert/strict';import {available,quote,addOrder,transition,totals,parseCSV,importProduct,recordInvoice} from '../dist/domain.js';
const rule={fee:16,fixed:6,freight:5,tax:6,margin:25,programFee:0,subsidy:0,fulfillment:0};
const setup=()=>({products:[{id:'p',sku:'A',name:'Camiseta',stock:10,reserved:0,safety:2,cost:25,price:70}],orders:[],rules:{'Mercado Livre':{...rule}},nextOrder:1});
test('reserva altera disponível e indicadores; cancelamento restaura',()=>{const s=setup();const o=addOrder(s,'p','Mercado Livre',3);assert.equal(available(s.products[0]),5);assert.equal(totals(s).total,210);transition(s,o.id,'Cancelado');assert.equal(available(s.products[0]),8);assert.equal(totals(s).total,0);assert.equal(totals(s).profit,0);});
test('envio baixa físico sem descontar disponível duas vezes',()=>{const s=setup(),o=addOrder(s,'p','Mercado Livre',3);transition(s,o.id,'Enviado');assert.equal(s.products[0].stock,7);assert.equal(s.products[0].reserved,0);assert.equal(available(s.products[0]),5);assert.throws(()=>transition(s,o.id,'Enviado'));});
test('bloqueia venda acima do saldo e quantidade inválida',()=>{for(const q of [9,0,-1,1.5,NaN]){const s=setup();assert.throws(()=>addOrder(s,'p','Mercado Livre',q));assert.equal(s.products[0].reserved,0);}});
test('alteração de preços e taxas não muda pedido histórico',()=>{const s=setup(),o=addOrder(s,'p','Mercado Livre',1),profit=o.profit;s.products[0].price=100;s.rules['Mercado Livre'].fee=30;assert.equal(o.total,70);assert.equal(o.profit,profit);const next=addOrder(s,'p','Mercado Livre',1);assert.equal(next.total,100);assert.notEqual(next.profit,profit);});
test('programas logísticos e subsídio entram no cálculo',()=>{assert.equal(quote(25,rule),67.93);assert.ok(quote(25,{...rule,subsidy:5})<quote(25,rule));assert.ok(quote(25,{...rule,programFee:5,fulfillment:2})>quote(25,rule));assert.throws(()=>quote(25,{...rule,fee:90}));assert.throws(()=>quote(25,{...rule,subsidy:-1}));});
test('CSV preserva zeros, vírgulas, aspas e quebra em descrição',()=>{const r=parseCSV('\uFEFFsku;nome;descricao;gtin\r\n"001";"Teste";"duas\nlinhas e ""aspas""";"000123"');assert.equal(r[0].sku,'001');assert.equal(r[0].gtin,'000123');assert.equal(r[0].descricao,'duas\nlinhas e "aspas"');assert.throws(()=>parseCSV('sku;nome\nA;"incompleto'));});
test('importação valida estoque reservado, URL e SKU',()=>{const old=setup().products[0];old.reserved=3;assert.throws(()=>importProduct({sku:'A',nome:'X',estoque:4,seguranca:2},old));assert.throws(()=>importProduct({sku:'A',nome:'X',imagens_urls:'javascript:alert(1)'},old));assert.throws(()=>importProduct({sku:'',nome:'X'},old));const p=importProduct({sku:'A',nome:'X',estoque:20,custo:'25,5',preco:75},old);assert.equal(p.reserved,3);assert.equal(p.cost,25.5);});

test('venda registra o preço real e impede referência duplicada no canal', () => {
  const s = setup();
  const sale = {reference: 'Pedido-100', unitPrice: 49.9};
  const order = addOrder(s, 'p', 'Mercado Livre', 2, sale);
  assert.equal(order.total, 99.8);
  assert.equal(order.saleReference, 'Pedido-100');
  assert.throws(() => addOrder(s, 'p', 'Mercado Livre', 1, sale), /já existe/i);
  assert.equal(s.products[0].reserved, 2);
  assert.equal(s.nextOrder, 2);
});

test('registra NF-e externa apenas em venda real e valida a chave', () => {
  const s = setup();
  const payload = {key: '29261199999999000199550010000000011000000011', issuer: 'Emissor de teste'};
  const simulated = addOrder(s, 'p', 'Mercado Livre', 1);
  const order = addOrder(s, 'p', 'Mercado Livre', 1, {reference: 'Pedido-200', unitPrice: 40});
  const other = addOrder(s, 'p', 'Mercado Livre', 1, {reference: 'Pedido-201', unitPrice: 40});
  assert.throws(() => recordInvoice(s, simulated.id, payload), /venda real/);
  assert.throws(() => recordInvoice(s, order.id, {...payload, key: payload.key.slice(0, -1) + ((Number(payload.key.at(-1)) + 1) % 10)}), /dígito/);
  recordInvoice(s, order.id, payload);
  assert.equal(order.invoice.key, payload.key);
  assert.throws(() => recordInvoice(s, other.id, payload), /outro pedido/);
});
