default: clean make-js ./public/javascripts/bundle.js ./enclave/ipld-dag-cbor.js css

clean:
	rm -f ./public/javascripts/bundle.js ./enclave/ipld-dag-cbor.js

make-js:
	mkdir -p ./public/javascripts

./public/javascripts/bundle.js:
	./node_modules/.bin/browserify -d -t [ babelify --presets [ es2015 react ] ] ./src/js/browser-app.js > $@

./enclave/ipld-dag-cbor.js:
	./node_modules/.bin/browserify --insert-global-vars __filename,__dirname --no-commondir -t [ babelify --presets [ es2015 ] ] ./src/js/ipld-dag-cbor.js > $@

css:
	cat ./public/stylesheets/styles/*.css > ./public/stylesheets/bundle.css