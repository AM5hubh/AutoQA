import express from 'express';
const app = express();
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get(['/', '/products', '/signup'], (req, res) => {
  const bugs = new Set(String(req.query.bugs || process.env.DEMO_BUGS || '').split(','));
  const flags = {
    search: bugs.has('search'),
    cart: bugs.has('cart'),
    validation: bugs.has('validation'),
    overflow: bugs.has('overflow'),
  };
  res
    .type('html')
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fieldwork — Demo Shop</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f3ed;color:#253229;font:16px system-ui}header,main{max-width:1050px;margin:auto;padding:28px}header{display:flex;justify-content:space-between;border-bottom:1px solid #ccc}a{color:#265542}h1{font-size:40px}button,input{font:inherit;padding:12px;border:1px solid #7e897e;border-radius:5px}button{background:#214b3a;color:white;cursor:pointer}input{background:white;color:#15241a}label{display:block;margin:16px 0 5px}.products{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;margin:30px 0}article{background:white;padding:24px;border:1px solid #ddd}form{max-width:420px}.swatch{height:120px;background:#d1ddd4;margin-bottom:20px}footer{padding:30px;text-align:center}#message{min-height:25px}@media(max-width:500px){h1{font-size:30px}${flags.overflow ? 'main{width:700px}' : ''}}</style></head><body><header><a href="/products">FIELDWORK</a><span>Cart <strong data-testid="cart-count">0</strong></span></header><main><h1>Everyday essentials.</h1><p>A controlled storefront for testing. All data stays in this browser session.</p><label for="search">Search products</label><input id="search" type="search" placeholder="Try shirt" data-testid="search"><div class="products" data-testid="products"><article data-testid="product-shirt"><div class="swatch"></div><h2>Cotton shirt</h2><p>$29</p><button data-testid="add-shirt">Add shirt to cart</button></article><article data-testid="product-bag"><div class="swatch" style="background:#d7d0bd"></div><h2>Canvas bag</h2><p>$18</p><button data-testid="add-bag">Add bag to cart</button></article></div><section><h2>Join the newsletter</h2><p>Demo only. No email is sent.</p><form novalidate>${bugs.has('accessibility') ? '<span>Email address</span>' : '<label for="email">Email address</label>'}<input id="email" type="email" data-testid="email"><p id="message" role="alert" data-testid="validation-message"></p><button type="submit">Subscribe</button></form></section></main><footer>Fieldwork / AutoQA controlled test fixture</footer><script>const bugs=${JSON.stringify(flags)};let count=0;document.querySelectorAll('[data-testid^="add-"]').forEach(button=>button.addEventListener('click',()=>{count++;if(!bugs.cart)document.querySelector('[data-testid="cart-count"]').textContent=String(count)}));document.querySelector('#search').addEventListener('input',event=>{if(bugs.search)return;const query=event.target.value.toLowerCase();document.querySelectorAll('article').forEach(product=>product.hidden=!product.querySelector('h2').textContent.toLowerCase().includes(query))});document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();document.querySelector('#message').textContent=(!bugs.validation&&!document.querySelector('#email').value.trim())?'Email is required':'Thanks for subscribing'});</script></body></html>`,
    );
});
app.listen(Number(process.env.DEMO_PORT || 4100), '0.0.0.0', () =>
  console.log('Controlled demo shop listening on port ' + (process.env.DEMO_PORT || 4100)),
);
