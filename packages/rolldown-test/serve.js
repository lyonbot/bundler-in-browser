const express = require('express')
const { resolve } = require('path')

const app = express()

app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
  next()
})
app.use(express.static(resolve(__dirname, './dist')))
app.listen(3000)

console.log('http://localhost:3000')