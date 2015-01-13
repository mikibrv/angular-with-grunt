/**
 * Created by mcsere on 1/9/15.
 */

module.exports = function (grunt) {
    grunt.config('cachebreaker', {
        cachebreaker: {
            options: {
                match: ['.min.js', '.min.css'],
                position: 'filename'
            },
            files: {
                src: ['<%=env.root%>/index.html']
            }
        }
    });
};