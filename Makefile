default: clean-js ./public/javascripts/bundle.js ./enclave/enclave-imports.js ./public/stylesheets/bundle.css

clean: clean-js
	rm -f ./public/stylesheets/styles/style.css ./public/stylesheets/bundle.css

clean-js:
	rm -f ./public/javascripts/bundle.js ./enclave/enclave-imports.js

./public/javascripts/bundle.js:
	mkdir -p ./public/javascripts
	./node_modules/.bin/browserify -d -t [ babelify --presets [ es2015 react ] ] ./src/js/browser-app.js > $@

./enclave/enclave-imports.js:
	mkdir -p ./enclave
	./node_modules/.bin/browserify --insert-global-vars __filename,__dirname --no-commondir -t [ babelify --presets [ es2015 ] ] ./src/js/enclave-imports.js > $@

./public/stylesheets/bundle.css: ./src/jsx/stylesheets/main.less
	./node_modules/.bin/lessc ./src/jsx/stylesheets/main.less $@
